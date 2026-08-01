package importer

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"study-os/backend/db"

	_ "modernc.org/sqlite"
)

func TestInspectSQLiteReportsFullRowCountAndTables(t *testing.T) {
	path := filepath.Join(t.TempDir(), "words.sqlite")
	database, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if _, err := database.Exec(`CREATE TABLE words(term TEXT, definition TEXT); CREATE TABLE other(value TEXT);`); err != nil {
		database.Close()
		t.Fatalf("create tables: %v", err)
	}
	for i := 0; i < 6; i++ {
		if _, err := database.Exec(`INSERT INTO words(term, definition) VALUES (?, ?)`, string(rune('a'+i)), "definition"); err != nil {
			database.Close()
			t.Fatalf("insert row %d: %v", i, err)
		}
	}
	if err := database.Close(); err != nil {
		t.Fatalf("close sqlite: %v", err)
	}

	inspection, err := InspectFile(context.Background(), path, "words")
	if err != nil {
		t.Fatalf("inspect sqlite: %v", err)
	}
	if inspection.RowCount != 6 {
		t.Fatalf("row count = %d, want 6", inspection.RowCount)
	}
	if len(inspection.SampleRows) != 5 {
		t.Fatalf("sample rows = %d, want 5", len(inspection.SampleRows))
	}
	if !contains(inspection.Tables, "words") || !contains(inspection.Tables, "other") {
		t.Fatalf("tables = %#v, want words and other", inspection.Tables)
	}
}

func TestInspectSQLiteRejectsViewAsImportTable(t *testing.T) {
	path := filepath.Join(t.TempDir(), "views.sqlite")
	database, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if _, err := database.Exec(`CREATE TABLE words(term TEXT); INSERT INTO words VALUES ('x'); CREATE VIEW words_view AS SELECT * FROM words;`); err != nil {
		database.Close()
		t.Fatalf("create schema: %v", err)
	}
	if err := database.Close(); err != nil {
		t.Fatalf("close sqlite: %v", err)
	}

	if _, err := InspectFile(context.Background(), path, "words_view"); err == nil {
		t.Fatal("expected view table selection to be rejected")
	}
}

func TestInspectCSVRejectsDuplicateHeaders(t *testing.T) {
	path := filepath.Join(t.TempDir(), "duplicate.csv")
	if err := os.WriteFile(path, []byte("term,term\nfirst,second\n"), 0o600); err != nil {
		t.Fatalf("write csv: %v", err)
	}
	if _, err := InspectFile(context.Background(), path, ""); err == nil {
		t.Fatal("expected duplicate CSV headers to be rejected")
	}
}

func TestPreviewCannotRollBackCommittedJob(t *testing.T) {
	ctx := context.Background()
	dataDir := t.TempDir()
	store, err := db.Open(ctx, filepath.Join(dataDir, "study.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	service := NewService(store, dataDir)
	uploaded, err := service.Upload(ctx, strings.NewReader("term,definition\nrace,condition\n"), "race.csv", "")
	if err != nil {
		t.Fatalf("upload import: %v", err)
	}
	if _, err := service.Preview(ctx, uploaded.JobID, Mapping{Term: "term", Definition: "definition"}); err != nil {
		t.Fatalf("initial preview: %v", err)
	}

	previewReachedSave := make(chan struct{})
	allowPreviewSave := make(chan struct{})
	var once sync.Once
	service.beforePreviewSave = func() {
		once.Do(func() {
			close(previewReachedSave)
			<-allowPreviewSave
		})
	}
	previewErrors := make(chan error, 1)
	go func() {
		_, previewErr := service.Preview(ctx, uploaded.JobID, Mapping{Term: "term", Definition: "definition"})
		previewErrors <- previewErr
	}()
	select {
	case <-previewReachedSave:
	case <-time.After(5 * time.Second):
		t.Fatal("preview did not reach save hook")
	}
	if _, err := service.Commit(ctx, uploaded.JobID, nil); err != nil {
		t.Fatalf("commit while preview is paused: %v", err)
	}
	close(allowPreviewSave)
	select {
	case previewErr := <-previewErrors:
		if previewErr == nil || !strings.Contains(previewErr.Error(), "already committed") {
			t.Fatalf("preview error = %v, want already committed", previewErr)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("preview did not finish")
	}
	job, err := store.GetImportJob(ctx, uploaded.JobID)
	if err != nil {
		t.Fatalf("get import job: %v", err)
	}
	if job.State != jobStateCommitted {
		t.Fatalf("job state = %q, want committed", job.State)
	}
	rows, err := store.ListImportRows(ctx, uploaded.JobID)
	if err != nil {
		t.Fatalf("list committed rows: %v", err)
	}
	if len(rows) != 1 || rows[0].Disposition != string(DispositionInsert) {
		t.Fatalf("committed rows = %#v", rows)
	}
	var sourceCount int
	if err := store.SQL().QueryRowContext(ctx, `SELECT COUNT(*) FROM sources WHERE id = ?`, "source-"+uploaded.JobID).Scan(&sourceCount); err != nil {
		t.Fatalf("count source: %v", err)
	}
	if sourceCount != 1 {
		t.Fatalf("source count = %d, want 1", sourceCount)
	}
}
