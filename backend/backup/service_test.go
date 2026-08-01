package backup

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"testing"
	"time"

	_ "modernc.org/sqlite"
)

func TestCreateBackupVerifiesSQLiteAndPrunesDailyCopies(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	dbPath := filepath.Join(root, "study.db")
	seedSQLite(t, dbPath)

	clock := func() time.Time { return time.Date(2026, 8, 1, 12, 30, 0, 0, time.UTC) }
	service := NewService(filepath.Join(root, "backups"), WithClock(clock), WithRetention(Daily, 2))

	first, err := service.Create(context.Background(), dbPath, Daily)
	if err != nil {
		t.Fatalf("create first backup: %v", err)
	}
	if first.Category != Daily || first.Path == "" {
		t.Fatalf("unexpected backup result: %#v", first)
	}
	if err := VerifySQLite(first.Path); err != nil {
		t.Fatalf("created backup is not valid sqlite: %v", err)
	}

	// Different source databases ensure unique names even when the clock is fixed.
	for i := 0; i < 2; i++ {
		other := filepath.Join(root, "study-"+string(rune('a'+i))+".db")
		seedSQLite(t, other)
		if _, err := service.Create(context.Background(), other, Daily); err != nil {
			t.Fatalf("create backup %d: %v", i, err)
		}
	}

	entries, err := os.ReadDir(filepath.Join(root, "backups", string(Daily)))
	if err != nil {
		t.Fatalf("read backup directory: %v", err)
	}
	if len(entries) != 2 {
		t.Fatalf("retention removed wrong number of daily copies: got %d, want 2", len(entries))
	}
}

func TestCreateBackupRejectsCorruptSourceAndDoesNotPublishCopy(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	badPath := filepath.Join(root, "corrupt.db")
	if err := os.WriteFile(badPath, []byte("not sqlite"), 0o600); err != nil {
		t.Fatal(err)
	}

	service := NewService(filepath.Join(root, "backups"))
	if _, err := service.Create(context.Background(), badPath, PreUpdate); err == nil {
		t.Fatal("expected corrupt source to be rejected")
	}
	backupRoot := filepath.Join(root, "backups")
	entries, err := os.ReadDir(backupRoot)
	if err != nil && !os.IsNotExist(err) {
		t.Fatal(err)
	}
	if err == nil && len(entries) != 0 {
		t.Fatalf("corrupt backup left published entries: %d", len(entries))
	}
}

func TestCreateDailyIfNeededCreatesOnlyOneBackupPerUTCDay(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	dbPath := filepath.Join(root, "study.db")
	seedSQLite(t, dbPath)
	now := time.Date(2026, 8, 1, 23, 30, 0, 0, time.UTC)
	service := NewService(filepath.Join(root, "backups"), WithClock(func() time.Time { return now }))

	first, created, err := service.CreateDailyIfNeeded(context.Background(), dbPath)
	if err != nil || !created {
		t.Fatalf("first daily backup = %#v, created=%v, err=%v", first, created, err)
	}
	second, created, err := service.CreateDailyIfNeeded(context.Background(), dbPath)
	if err != nil || created || second.Path != first.Path {
		t.Fatalf("second daily backup = %#v, created=%v, err=%v", second, created, err)
	}

	now = now.Add(24 * time.Hour)
	third, created, err := service.CreateDailyIfNeeded(context.Background(), dbPath)
	if err != nil || !created || third.Path == first.Path {
		t.Fatalf("next-day backup = %#v, created=%v, err=%v", third, created, err)
	}
}

func TestVerifySQLiteRejectsCorruptCopy(t *testing.T) {
	t.Parallel()

	path := filepath.Join(t.TempDir(), "bad.db")
	if err := os.WriteFile(path, []byte("broken"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := VerifySQLite(path); err == nil {
		t.Fatal("expected invalid sqlite file to fail verification")
	}
}

func TestRestoreBackupAtomicallyReplacesDestination(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	source := filepath.Join(root, "source.db")
	destination := filepath.Join(root, "destination.db")
	seedSQLiteValue(t, source, "from-backup")
	seedSQLiteValue(t, destination, "keep-until-replaced")

	service := NewService(filepath.Join(root, "backups"))
	created, err := service.Create(context.Background(), source, PreUpdate)
	if err != nil {
		t.Fatalf("create backup: %v", err)
	}
	if err := service.Restore(context.Background(), created.Path, destination); err != nil {
		t.Fatalf("restore backup: %v", err)
	}
	if err := VerifySQLite(destination); err != nil {
		t.Fatalf("restored destination is invalid: %v", err)
	}

	db, err := sql.Open("sqlite", destination+"?mode=ro")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var value string
	if err := db.QueryRow("SELECT value FROM facts WHERE id = 1").Scan(&value); err != nil {
		t.Fatalf("read restored value: %v", err)
	}
	if value != "from-backup" {
		t.Fatalf("restored value = %q, want %q", value, "from-backup")
	}
}

func TestRestoreBackupRejectsSamePath(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	source := filepath.Join(root, "source.db")
	seedSQLite(t, source)
	service := NewService(filepath.Join(root, "backups"))
	created, err := service.Create(context.Background(), source, Daily)
	if err != nil {
		t.Fatalf("create backup: %v", err)
	}
	if err := service.Restore(context.Background(), created.Path, created.Path); err == nil {
		t.Fatal("expected restoring onto the backup itself to fail")
	}
}

func TestRestoreBackupRejectsDatabaseOutsideBackupRoot(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	outside := filepath.Join(root, "outside.db")
	destination := filepath.Join(root, "destination.db")
	seedSQLite(t, outside)
	service := NewService(filepath.Join(root, "backups"))
	if err := service.Restore(context.Background(), outside, destination); err == nil {
		t.Fatal("expected database outside the backup root to be rejected")
	}
}

func seedSQLite(t *testing.T, path string) {
	seedSQLiteValue(t, path, "seed")
}

func seedSQLiteValue(t *testing.T, path, value string) {
	t.Helper()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(`CREATE TABLE facts (id INTEGER PRIMARY KEY, value TEXT); INSERT INTO facts(value) VALUES (?)`, value); err != nil {
		t.Fatal(err)
	}
}
