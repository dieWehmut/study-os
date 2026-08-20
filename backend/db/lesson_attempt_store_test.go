package db_test

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"study-os/backend/db"
	"study-os/backend/models"

	_ "modernc.org/sqlite"
)

func TestLessonPracticeAttemptPersistsAndListsNewestFirst(t *testing.T) {
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "study.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	if db.SchemaVersion < 14 {
		t.Fatalf("schema version = %d, want at least 14", db.SchemaVersion)
	}
	if err := store.CreateLesson(ctx, models.Lesson{
		ID: "lesson-attempts", Title: "练习证据", Document: models.NewLessonDocument(),
	}); err != nil {
		t.Fatalf("create lesson: %v", err)
	}
	base := time.Date(2026, 8, 20, 1, 2, 3, 0, time.UTC)
	older := models.LessonPracticeAttempt{
		ID: "lesson-attempt-old", LessonID: "lesson-attempts", SectionID: "practice",
		Answer: "8 N", Evaluation: models.LessonPracticeEvaluationCorrect,
		ReferenceAnswer: "8 N", Feedback: "正确", ElapsedMS: 1200, CreatedAt: base,
	}
	newer := models.LessonPracticeAttempt{
		ID: "lesson-attempt-new", LessonID: "lesson-attempts", SectionID: "practice",
		Answer: "6 N", Evaluation: models.LessonPracticeEvaluationIncorrect,
		ReferenceAnswer: "8 N", Feedback: "检查 F = ma", ElapsedMS: 2400, CreatedAt: base.Add(time.Second),
	}
	for _, attempt := range []models.LessonPracticeAttempt{older, newer} {
		if err := store.CreateLessonPracticeAttempt(ctx, attempt); err != nil {
			t.Fatalf("create attempt %q: %v", attempt.ID, err)
		}
	}
	items, err := store.ListLessonPracticeAttempts(ctx, "lesson-attempts", "practice")
	if err != nil {
		t.Fatalf("list attempts: %v", err)
	}
	if len(items) != 2 || items[0].ID != newer.ID || items[1].ID != older.ID {
		t.Fatalf("attempt order = %#v, want newest first", items)
	}
	if items[0].ElapsedMS != newer.ElapsedMS || items[0].ReferenceAnswer != newer.ReferenceAnswer || !items[0].CreatedAt.Equal(newer.CreatedAt) {
		t.Fatalf("newest attempt changed on round trip: %#v", items[0])
	}

	limited, err := store.ListLessonPracticeAttempts(ctx, "lesson-attempts", "practice", models.LessonPracticeAttemptListOptions{Limit: 1, Offset: 1})
	if err != nil {
		t.Fatalf("list with window: %v", err)
	}
	if len(limited) != 1 || limited[0].ID != older.ID {
		t.Fatalf("windowed attempts = %#v", limited)
	}
}

func TestLessonPracticeAttemptRejectsInvalidInputAndMissingLesson(t *testing.T) {
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "study.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	cases := []struct {
		name string
		item models.LessonPracticeAttempt
		want string
	}{
		{name: "missing id", item: models.LessonPracticeAttempt{LessonID: "lesson", SectionID: "practice", Answer: "x", Evaluation: models.LessonPracticeEvaluationUngraded}, want: "id"},
		{name: "missing lesson", item: models.LessonPracticeAttempt{ID: "attempt-missing-lesson", LessonID: "missing", SectionID: "practice", Answer: "x", Evaluation: models.LessonPracticeEvaluationUngraded}, want: "not found"},
		{name: "empty answer", item: models.LessonPracticeAttempt{ID: "attempt-empty-answer", LessonID: "missing", SectionID: "practice", Evaluation: models.LessonPracticeEvaluationUngraded}, want: "answer"},
		{name: "negative elapsed", item: models.LessonPracticeAttempt{ID: "attempt-negative-elapsed", LessonID: "missing", SectionID: "practice", Answer: "x", Evaluation: models.LessonPracticeEvaluationUngraded, ElapsedMS: -1}, want: "elapsed"},
		{name: "invalid evaluation", item: models.LessonPracticeAttempt{ID: "attempt-invalid-evaluation", LessonID: "missing", SectionID: "practice", Answer: "x", Evaluation: "maybe"}, want: "evaluation"},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			err := store.CreateLessonPracticeAttempt(ctx, testCase.item)
			if err == nil || !containsError(err, testCase.want) {
				t.Fatalf("error = %v, want substring %q", err, testCase.want)
			}
		})
	}
}

func TestStoreUpgradesSchemaVersionThirteenWithLessonAttemptTable(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "legacy-v13.db")
	legacy, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("open legacy sqlite: %v", err)
	}
	if _, err := legacy.ExecContext(ctx, `
		CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
		INSERT INTO schema_migrations(version, applied_at) VALUES (13, '2026-08-01T00:00:00Z');
		CREATE TABLE lessons (id TEXT PRIMARY KEY, subject TEXT NOT NULL DEFAULT '', title TEXT NOT NULL,
			source_type TEXT NOT NULL DEFAULT '', source_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'draft',
			current_version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
		CREATE TABLE lesson_versions (lesson_id TEXT NOT NULL, version INTEGER NOT NULL,
			schema_version INTEGER NOT NULL DEFAULT 1, document_json TEXT NOT NULL, created_at TEXT NOT NULL,
			PRIMARY KEY (lesson_id, version));
		CREATE TABLE lesson_links (lesson_id TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT NOT NULL,
			created_at TEXT NOT NULL, PRIMARY KEY (lesson_id, target_type, target_id));
	`); err != nil {
		_ = legacy.Close()
		t.Fatalf("create legacy schema: %v", err)
	}
	if err := legacy.Close(); err != nil {
		t.Fatalf("close legacy sqlite: %v", err)
	}

	store, err := db.Open(ctx, path)
	if err != nil {
		t.Fatalf("upgrade version 13 store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	var tableCount, indexCount, migrationCount int
	if err := store.SQL().QueryRowContext(ctx, `SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'lesson_attempts'`).Scan(&tableCount); err != nil {
		t.Fatalf("inspect lesson_attempts: %v", err)
	}
	if err := store.SQL().QueryRowContext(ctx, `SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'lesson_attempts_lesson_section_idx'`).Scan(&indexCount); err != nil {
		t.Fatalf("inspect lesson attempt index: %v", err)
	}
	if err := store.SQL().QueryRowContext(ctx, `SELECT COUNT(*) FROM schema_migrations WHERE version = ?`, db.SchemaVersion).Scan(&migrationCount); err != nil {
		t.Fatalf("inspect migration marker: %v", err)
	}
	if tableCount != 1 || indexCount != 1 || migrationCount != 1 {
		t.Fatalf("migration objects table=%d index=%d marker=%d", tableCount, indexCount, migrationCount)
	}
}

func TestStoreRejectsSchemaVersionFourteenWithoutLessonDependencies(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "corrupt-v14.db")
	database, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("open corrupt sqlite: %v", err)
	}
	if _, err := database.ExecContext(ctx, `
		CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
		INSERT INTO schema_migrations(version, applied_at) VALUES (14, '2026-08-20T00:00:00Z');
		CREATE TABLE lesson_attempts (
			id TEXT PRIMARY KEY,
			lesson_id TEXT NOT NULL,
			section_id TEXT NOT NULL,
			answer TEXT NOT NULL,
			evaluation TEXT NOT NULL,
			reference_answer TEXT NOT NULL DEFAULT '',
			feedback TEXT NOT NULL DEFAULT '',
			elapsed_ms INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL
		);
	`); err != nil {
		_ = database.Close()
		t.Fatalf("create corrupt schema: %v", err)
	}
	if err := database.Close(); err != nil {
		t.Fatalf("close corrupt sqlite: %v", err)
	}

	if _, err := db.Open(ctx, path); err == nil || !stringsContains(err.Error(), "lesson dependencies") {
		t.Fatalf("open error = %v, want missing lesson dependencies", err)
	}
}

func containsError(err error, want string) bool {
	return err != nil && (errors.Is(err, db.ErrNotFound) || stringsContains(err.Error(), want))
}

func stringsContains(value, fragment string) bool {
	for i := 0; i+len(fragment) <= len(value); i++ {
		if value[i:i+len(fragment)] == fragment {
			return true
		}
	}
	return false
}
