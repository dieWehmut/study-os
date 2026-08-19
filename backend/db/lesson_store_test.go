package db_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"

	"study-os/backend/db"
	"study-os/backend/models"
)

func openLessonStore(t *testing.T) (*db.Store, context.Context) {
	t.Helper()
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "study.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store, ctx
}

func TestLessonCreateNormalizesTemplateAndPreservesSource(t *testing.T) {
	store, ctx := openLessonStore(t)
	lesson := models.Lesson{
		ID: "lesson-1", Subject: "physics", Title: "受力分析",
		SourceType: "integrated_note", SourceID: "note-1",
		Document: models.LessonDocument{Sections: []models.LessonSection{{
			Type: "concept", Content: json.RawMessage(`{"markdown":"力是物体间的相互作用"}`),
		}}},
	}
	if err := store.CreateLesson(ctx, lesson); err != nil {
		t.Fatalf("create lesson: %v", err)
	}
	got, err := store.GetLesson(ctx, lesson.ID)
	if err != nil {
		t.Fatalf("get lesson: %v", err)
	}
	if got.Status != models.LessonStatusDraft || got.CurrentVersion != 1 || got.SourceID != lesson.SourceID {
		t.Fatalf("metadata = %#v", got)
	}
	if got.Document.SchemaVersion != models.LessonDocumentSchemaVersion || len(got.Document.Sections) != 10 {
		t.Fatalf("document = %#v", got.Document)
	}
	if string(got.Document.Sections[2].Content) != `{"markdown":"力是物体间的相互作用"}` {
		t.Fatalf("concept content = %s", got.Document.Sections[2].Content)
	}
	if got.Document.Sections[2].Position != 2 || !got.Document.Sections[2].Required {
		t.Fatalf("concept section metadata = %#v", got.Document.Sections[2])
	}
}

func TestLessonUpdateVersionsAndRejectsStaleWriter(t *testing.T) {
	store, ctx := openLessonStore(t)
	lesson := models.Lesson{ID: "lesson-2", Title: "初稿", Document: models.NewLessonDocument()}
	if err := store.CreateLesson(ctx, lesson); err != nil {
		t.Fatalf("create lesson: %v", err)
	}
	lesson.Title = "修订稿"
	lesson.Status = models.LessonStatusReviewed
	lesson.Document = models.LessonDocument{Sections: []models.LessonSection{{
		Type: "summary", Content: json.RawMessage(`{"text":"总结"}`),
	}}}
	updated, err := store.UpdateLesson(ctx, lesson, 1)
	if err != nil {
		t.Fatalf("update lesson: %v", err)
	}
	if updated.CurrentVersion != 2 || updated.Status != models.LessonStatusReviewed {
		t.Fatalf("updated = %#v", updated)
	}
	old, err := store.GetLessonVersion(ctx, lesson.ID, 1)
	if err != nil {
		t.Fatalf("get old version: %v", err)
	}
	if old.Version != 1 || string(old.Document.Sections[7].Content) != `{}` {
		t.Fatalf("old version changed = %#v", old)
	}
	if _, err := store.UpdateLesson(ctx, updated, 1); !errors.Is(err, db.ErrLessonVersionConflict) {
		t.Fatalf("stale update error = %v, want conflict", err)
	}
	items, err := store.ListLessons(ctx, models.LessonListOptions{Subject: "", Status: models.LessonStatusReviewed, Limit: 10})
	if err != nil || len(items) != 1 || items[0].CurrentVersion != 2 {
		t.Fatalf("list = %#v, err=%v", items, err)
	}
}

func TestLessonCreateIsAtomicWhenVersionInsertFails(t *testing.T) {
	store, ctx := openLessonStore(t)
	if _, err := store.SQL().ExecContext(ctx, `
		CREATE TRIGGER fail_lesson_version BEFORE INSERT ON lesson_versions
		BEGIN SELECT RAISE(ABORT, 'version write rejected'); END`); err != nil {
		t.Fatalf("create trigger: %v", err)
	}
	err := store.CreateLesson(ctx, models.Lesson{ID: "lesson-atomic", Title: "原子性", Document: models.NewLessonDocument()})
	if err == nil {
		t.Fatal("create lesson succeeded despite version trigger")
	}
	var count int
	if err := store.SQL().QueryRowContext(ctx, `SELECT COUNT(*) FROM lessons WHERE id = ?`, "lesson-atomic").Scan(&count); err != nil {
		t.Fatalf("count lesson: %v", err)
	}
	if count != 0 {
		t.Fatalf("lesson row survived failed transaction: %d", count)
	}
	var versions int
	if err := store.SQL().QueryRowContext(ctx, `SELECT COUNT(*) FROM lesson_versions WHERE lesson_id = ?`, "lesson-atomic").Scan(&versions); err != nil {
		t.Fatalf("count versions: %v", err)
	}
	if versions != 0 {
		t.Fatalf("version rows survived failed transaction: %d", versions)
	}
}

func TestLessonCreateRejectsDuplicateIDWithoutChangingOriginal(t *testing.T) {
	store, ctx := openLessonStore(t)
	original := models.Lesson{ID: "lesson-duplicate", Title: "Original", Document: models.NewLessonDocument()}
	if err := store.CreateLesson(ctx, original); err != nil {
		t.Fatalf("create original lesson: %v", err)
	}

	replacement := models.Lesson{ID: original.ID, Title: "Replacement", Document: models.NewLessonDocument()}
	if err := store.CreateLesson(ctx, replacement); !errors.Is(err, db.ErrLessonAlreadyExists) {
		t.Fatalf("duplicate create error = %v, want ErrLessonAlreadyExists", err)
	}

	got, err := store.GetLesson(ctx, original.ID)
	if err != nil {
		t.Fatalf("get original lesson: %v", err)
	}
	if got.Title != original.Title || got.CurrentVersion != 1 {
		t.Fatalf("original lesson changed = %#v", got)
	}
}

func TestStoreUpgradesSchemaVersionElevenWithLessonTables(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "legacy-v11.db")
	legacy, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("open legacy sqlite: %v", err)
	}
	if _, err := legacy.ExecContext(ctx, `
		CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
		INSERT INTO schema_migrations(version, applied_at) VALUES (11, '2026-08-01T00:00:00Z');
	`); err != nil {
		_ = legacy.Close()
		t.Fatalf("create version 11 marker: %v", err)
	}
	if err := legacy.Close(); err != nil {
		t.Fatalf("close legacy sqlite: %v", err)
	}

	store, err := db.Open(ctx, path)
	if err != nil {
		t.Fatalf("upgrade version 11 store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	for _, table := range []string{"lessons", "lesson_versions"} {
		var count int
		if err := store.SQL().QueryRowContext(ctx,
			`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?`, table).Scan(&count); err != nil {
			t.Fatalf("inspect table %s: %v", table, err)
		}
		if count != 1 {
			t.Fatalf("table %s count = %d, want 1", table, count)
		}
	}
	var applied int
	if err := store.SQL().QueryRowContext(ctx,
		`SELECT COUNT(*) FROM schema_migrations WHERE version = ?`, db.SchemaVersion).Scan(&applied); err != nil {
		t.Fatalf("inspect lesson migration marker: %v", err)
	}
	if applied != 1 {
		t.Fatalf("schema version %d marker count = %d, want 1", db.SchemaVersion, applied)
	}

	if err := store.CreateLesson(ctx, models.Lesson{
		ID: "lesson-after-migration", Title: "Migrated", Document: models.NewLessonDocument(),
	}); err != nil {
		t.Fatalf("create lesson after migration: %v", err)
	}
}
