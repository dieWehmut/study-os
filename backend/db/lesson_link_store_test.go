package db_test

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"testing"

	"study-os/backend/db"
	"study-os/backend/models"

	_ "modernc.org/sqlite"
)

func TestLessonLinksRequireExistingTargetsAndSupportBothDirections(t *testing.T) {
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "study.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	if err := store.CreateLesson(ctx, models.Lesson{
		ID: "lesson-links", Title: "关联测试", Document: models.NewLessonDocument(),
	}); err != nil {
		t.Fatalf("create lesson: %v", err)
	}
	if err := store.CreateKnowledgeItem(ctx, models.KnowledgeItem{
		ID: "knowledge-links", ItemType: "concept", Term: "力", ConciseDefinition: "相互作用",
	}); err != nil {
		t.Fatalf("create knowledge item: %v", err)
	}
	if err := store.CreatePrompt(ctx, models.Prompt{
		ID: "prompt-links", KnowledgeItemID: "knowledge-links", PromptType: "en_to_zh",
		Question: "力是什么？",
	}); err != nil {
		t.Fatalf("create prompt: %v", err)
	}

	links := []models.LessonLink{
		{LessonID: "lesson-links", TargetType: models.LessonLinkTargetKnowledgeItem, TargetID: "knowledge-links"},
		{LessonID: "lesson-links", TargetType: models.LessonLinkTargetPrompt, TargetID: "prompt-links"},
	}
	for _, link := range links {
		if err := store.CreateLessonLink(ctx, link); err != nil {
			t.Fatalf("create %s link: %v", link.TargetType, err)
		}
	}
	if err := store.CreateLessonLink(ctx, links[0]); !errors.Is(err, db.ErrLessonLinkAlreadyExists) {
		t.Fatalf("duplicate link error = %v, want ErrLessonLinkAlreadyExists", err)
	}

	got, err := store.ListLessonLinks(ctx, "lesson-links", models.LessonLinkListOptions{})
	if err != nil {
		t.Fatalf("list lesson links: %v", err)
	}
	if len(got) != 2 || got[0].TargetType != models.LessonLinkTargetKnowledgeItem || got[1].TargetType != models.LessonLinkTargetPrompt {
		t.Fatalf("lesson links = %#v", got)
	}

	reverse, err := store.ListLessonsForLink(ctx, models.LessonLinkTargetKnowledgeItem, "knowledge-links")
	if err != nil {
		t.Fatalf("list reverse links: %v", err)
	}
	if len(reverse) != 1 || reverse[0].ID != "lesson-links" {
		t.Fatalf("reverse lessons = %#v", reverse)
	}

	if err := store.DeleteLessonLink(ctx, "lesson-links", models.LessonLinkTargetPrompt, "prompt-links"); err != nil {
		t.Fatalf("delete prompt link: %v", err)
	}
	remaining, err := store.ListLessonLinks(ctx, "lesson-links", models.LessonLinkListOptions{})
	if err != nil || len(remaining) != 1 || remaining[0].TargetID != "knowledge-links" {
		t.Fatalf("remaining links = %#v, err=%v", remaining, err)
	}
	if err := store.DeleteLessonLink(ctx, "lesson-links", models.LessonLinkTargetPrompt, "prompt-links"); !errors.Is(err, db.ErrNotFound) {
		t.Fatalf("missing delete error = %v, want ErrNotFound", err)
	}
}

func TestLessonLinksRejectUnknownLessonTargetAndType(t *testing.T) {
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "study.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	cases := []struct {
		name string
		link models.LessonLink
		want error
	}{
		{name: "empty lesson", link: models.LessonLink{TargetType: models.LessonLinkTargetKnowledgeItem, TargetID: "k"}, want: db.ErrInvalidLessonLink},
		{name: "unknown type", link: models.LessonLink{LessonID: "lesson", TargetType: "question", TargetID: "q"}, want: db.ErrInvalidLessonLink},
		{name: "missing lesson", link: models.LessonLink{LessonID: "missing", TargetType: models.LessonLinkTargetKnowledgeItem, TargetID: "k"}, want: db.ErrNotFound},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if err := store.CreateLessonLink(ctx, testCase.link); !errors.Is(err, testCase.want) {
				t.Fatalf("error = %v, want %v", err, testCase.want)
			}
		})
	}
}

func TestStoreUpgradesSchemaVersionTwelveWithLessonLinkTable(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "legacy-v12.db")
	legacy, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("open legacy sqlite: %v", err)
	}
	if _, err := legacy.ExecContext(ctx, `
		CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
		INSERT INTO schema_migrations(version, applied_at) VALUES (12, '2026-08-01T00:00:00Z');
		CREATE TABLE lessons (id TEXT PRIMARY KEY, subject TEXT NOT NULL DEFAULT '', title TEXT NOT NULL,
			source_type TEXT NOT NULL DEFAULT '', source_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'draft',
			current_version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
		CREATE TABLE lesson_versions (lesson_id TEXT NOT NULL, version INTEGER NOT NULL,
			schema_version INTEGER NOT NULL DEFAULT 1, document_json TEXT NOT NULL, created_at TEXT NOT NULL,
			PRIMARY KEY (lesson_id, version));
	`); err != nil {
		_ = legacy.Close()
		t.Fatalf("create legacy schema: %v", err)
	}
	if err := legacy.Close(); err != nil {
		t.Fatalf("close legacy sqlite: %v", err)
	}

	store, err := db.Open(ctx, path)
	if err != nil {
		t.Fatalf("upgrade version 12 store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	var count int
	if err := store.SQL().QueryRowContext(ctx,
		`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'lesson_links'`).Scan(&count); err != nil {
		t.Fatalf("inspect lesson_links: %v", err)
	}
	if count != 1 {
		t.Fatalf("lesson_links count = %d, want 1", count)
	}
	var applied int
	if err := store.SQL().QueryRowContext(ctx,
		`SELECT COUNT(*) FROM schema_migrations WHERE version = ?`, db.SchemaVersion).Scan(&applied); err != nil {
		t.Fatalf("inspect migration marker: %v", err)
	}
	if applied != 1 {
		t.Fatalf("schema version %d marker count = %d, want 1", db.SchemaVersion, applied)
	}
}
