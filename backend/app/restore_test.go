package app

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"study-os/backend/backup"
	"study-os/backend/config"
	"study-os/backend/models"
)

// startWith creates and closes an application over one data directory, returning
// the store's view of a term. Closing first is what a restart looks like.
func itemCount(t *testing.T, application *App) int {
	t.Helper()
	items, err := application.Store.ListKnowledgeItems(context.Background(), models.KnowledgeListOptions{})
	if err != nil {
		t.Fatalf("list items: %v", err)
	}
	return len(items)
}

// The restore happens at the only moment nobody holds the database: before it is
// opened. This is that moment.
func TestNewAppliesAPendingRestoreBeforeOpening(t *testing.T) {
	dataDir := t.TempDir()
	ctx := context.Background()
	cfg := config.Config{DataDir: dataDir}

	first, err := New(ctx, Options{Config: cfg})
	if err != nil {
		t.Fatalf("construct application: %v", err)
	}
	if err := first.Store.CreateKnowledgeItem(ctx, models.KnowledgeItem{
		ID: "k-before", ItemType: "word_sense", Term: "before", ConciseDefinition: "备份时的内容",
	}); err != nil {
		t.Fatalf("create item: %v", err)
	}
	// The backup is taken through the app's own service, so this is the same file
	// the settings page offers.
	created, err := first.Backups.Create(ctx, first.Config.DBPath, backup.Daily)
	if err != nil {
		t.Fatalf("create backup: %v", err)
	}
	// Then the reading moves on: this item exists only in the live database.
	if err := first.Store.CreateKnowledgeItem(ctx, models.KnowledgeItem{
		ID: "k-after", ItemType: "word_sense", Term: "after", ConciseDefinition: "备份之后才写的",
	}); err != nil {
		t.Fatalf("create second item: %v", err)
	}
	if err := first.Close(); err != nil {
		t.Fatalf("close application: %v", err)
	}

	if err := backup.WriteRestoreRequest(dataDir, created.Path); err != nil {
		t.Fatalf("write restore request: %v", err)
	}

	second, err := New(ctx, Options{Config: cfg})
	if err != nil {
		t.Fatalf("restart application: %v", err)
	}
	t.Cleanup(func() { _ = second.Close() })

	if got := itemCount(t, second); got != 1 {
		t.Fatalf("items after restore = %d, want the backup's single item", got)
	}
	if _, ok := backup.ReadRestoreRequest(dataDir); ok {
		t.Fatal("the request survived the restore, so it would run again next start")
	}
	// The outcome is what the page reads to say the restore happened.
	outcome, ok := backup.ReadRestoreOutcome(dataDir)
	if !ok || !outcome.OK {
		t.Fatalf("outcome = %+v (present %v), want a successful restore", outcome, ok)
	}
}

// The property that matters most: a note nobody can honour must not be the reason
// the app will not start.
func TestNewStartsAnywayWhenTheRequestedBackupIsUnusable(t *testing.T) {
	dataDir := t.TempDir()
	ctx := context.Background()
	cfg := config.Config{DataDir: dataDir}

	broken := filepath.Join(dataDir, "broken.db")
	if err := os.WriteFile(broken, []byte("SQLite format 3\x00truncated"), 0o600); err != nil {
		t.Fatalf("write broken backup: %v", err)
	}
	if err := backup.WriteRestoreRequest(dataDir, broken); err != nil {
		t.Fatalf("write restore request: %v", err)
	}

	application, err := New(ctx, Options{Config: cfg})
	if err != nil {
		t.Fatalf("application refused to start over a bad restore note: %v", err)
	}
	t.Cleanup(func() { _ = application.Close() })

	if _, ok := backup.ReadRestoreRequest(dataDir); ok {
		t.Fatal("a note that cannot be honoured was left behind to fail again")
	}
	outcome, ok := backup.ReadRestoreOutcome(dataDir)
	if !ok || outcome.OK {
		t.Fatalf("outcome = %+v (present %v), want a reported failure", outcome, ok)
	}
	if outcome.Detail == "" {
		t.Fatal("a failed restore with no reason cannot be explained to the reader")
	}
}
