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

func openErrorCauseStore(t *testing.T) (*db.Store, context.Context) {
	t.Helper()
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "study.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store, ctx
}

func TestErrorCauseSchemaSeedsTheCompatibleConfirmedTaxonomy(t *testing.T) {
	store, ctx := openErrorCauseStore(t)
	if db.SchemaVersion != 16 {
		t.Fatalf("schema version = %d, want 16", db.SchemaVersion)
	}

	causes, err := store.ListErrorCauses(ctx, models.ErrorCauseListOptions{
		Status: models.ErrorCauseStatusConfirmed,
	})
	if err != nil {
		t.Fatalf("list default error causes: %v", err)
	}
	wantIDs := []string{"recall", "misread", "careless", "method", "time", "unknown"}
	if len(causes) != len(wantIDs) {
		t.Fatalf("default causes = %#v", causes)
	}
	for index, want := range wantIDs {
		if causes[index].ID != want || causes[index].Subject != "" || causes[index].Status != models.ErrorCauseStatusConfirmed {
			t.Fatalf("default cause %d = %#v, want id %q global and confirmed", index, causes[index], want)
		}
		if causes[index].ReviewFixes != (want == "recall") {
			t.Fatalf("default cause %q review_fixes = %v", want, causes[index].ReviewFixes)
		}
	}
}

func TestErrorCauseStoreSupportsSubjectCandidatesAndConfirmation(t *testing.T) {
	store, ctx := openErrorCauseStore(t)
	candidate := models.ErrorCause{
		ID:         "physics:model-selection",
		Subject:    "physics",
		ParentID:   "method",
		Label:      "模型选择错误",
		Action:     "重画受力图，再选择运动模型",
		SourceType: "learning_session",
		SourceID:   "session-physics-1",
		SortOrder:  20,
	}
	if err := store.CreateErrorCause(ctx, candidate); err != nil {
		t.Fatalf("create candidate: %v", err)
	}
	created, err := store.GetErrorCause(ctx, candidate.ID)
	if err != nil {
		t.Fatalf("get candidate: %v", err)
	}
	if created.Status != models.ErrorCauseStatusCandidate || created.CreatedAt.IsZero() || created.UpdatedAt.IsZero() {
		t.Fatalf("created candidate = %#v", created)
	}

	candidates, err := store.ListErrorCauses(ctx, models.ErrorCauseListOptions{
		Subject: "physics", Status: models.ErrorCauseStatusCandidate,
	})
	if err != nil || len(candidates) != 1 || candidates[0].ID != candidate.ID {
		t.Fatalf("physics candidates = %#v, err=%v", candidates, err)
	}

	created.Status = models.ErrorCauseStatusConfirmed
	created.ReviewFixes = true
	created.Action = "画受力图并做一道同模型变式题"
	confirmed, err := store.UpdateErrorCause(ctx, created)
	if err != nil {
		t.Fatalf("confirm candidate: %v", err)
	}
	if confirmed.Status != models.ErrorCauseStatusConfirmed || !confirmed.ReviewFixes {
		t.Fatalf("confirmed = %#v", confirmed)
	}

	physics, err := store.ListErrorCauses(ctx, models.ErrorCauseListOptions{
		Subject: "physics", Status: models.ErrorCauseStatusConfirmed,
	})
	if err != nil || len(physics) != 7 {
		t.Fatalf("confirmed physics causes = %#v, err=%v", physics, err)
	}
	geography, err := store.ListErrorCauses(ctx, models.ErrorCauseListOptions{
		Subject: "geography", Status: models.ErrorCauseStatusConfirmed,
	})
	if err != nil || len(geography) != 6 {
		t.Fatalf("confirmed geography causes = %#v, err=%v", geography, err)
	}

	if err := store.CreateErrorCause(ctx, candidate); !errors.Is(err, db.ErrErrorCauseAlreadyExists) {
		t.Fatalf("duplicate error = %v, want ErrErrorCauseAlreadyExists", err)
	}
	if err := store.CreateErrorCause(ctx, models.ErrorCause{
		ID: "geography:wrong-parent", Subject: "geography", ParentID: candidate.ID, Label: "跨科父级",
	}); !errors.Is(err, db.ErrInvalidErrorCause) {
		t.Fatalf("cross-subject parent error = %v, want ErrInvalidErrorCause", err)
	}
}

func TestErrorCauseStoreReclassifiesOnlyWithAnApplicableConfirmedCause(t *testing.T) {
	store, ctx := openErrorCauseStore(t)
	cause := models.ErrorCause{
		ID: "physics:model-selection", Subject: "physics", ParentID: "method",
		Label: "模型选择错误", ReviewFixes: true,
	}
	if err := store.CreateErrorCause(ctx, cause); err != nil {
		t.Fatalf("create candidate: %v", err)
	}
	filed, err := store.RecordMistake(ctx, models.MistakeInput{
		Subject: "physics", Stem: "斜面上的物体如何运动？", Cause: "模型没选对",
	})
	if err != nil {
		t.Fatalf("record free-text mistake: %v", err)
	}
	if _, err := store.ReclassifyMistake(ctx, filed.Attempt.ID, cause.ID); !errors.Is(err, db.ErrInvalidErrorCause) {
		t.Fatalf("candidate reclassification error = %v, want ErrInvalidErrorCause", err)
	}

	cause.Status = models.ErrorCauseStatusConfirmed
	if _, err := store.UpdateErrorCause(ctx, cause); err != nil {
		t.Fatalf("confirm cause: %v", err)
	}
	reclassified, err := store.ReclassifyMistake(ctx, filed.Attempt.ID, cause.ID)
	if err != nil {
		t.Fatalf("reclassify mistake: %v", err)
	}
	if reclassified.Attempt.Cause != cause.ID {
		t.Fatalf("reclassified cause = %q, want %q", reclassified.Attempt.Cause, cause.ID)
	}

	reviewFixes, err := store.ErrorCauseReviewFixes(ctx, "physics", cause.ID)
	if err != nil || !reviewFixes {
		t.Fatalf("physics custom review decision = %v, err=%v", reviewFixes, err)
	}
	reviewFixes, err = store.ErrorCauseReviewFixes(ctx, "geography", cause.ID)
	if err != nil || reviewFixes {
		t.Fatalf("cross-subject review decision = %v, err=%v", reviewFixes, err)
	}
	reviewFixes, err = store.ErrorCauseReviewFixes(ctx, "physics", "unstructured free text")
	if err != nil || reviewFixes {
		t.Fatalf("free-text review decision = %v, err=%v", reviewFixes, err)
	}

	other, err := store.RecordMistake(ctx, models.MistakeInput{
		Subject: "geography", Stem: "城市热岛效应", Cause: "unknown",
	})
	if err != nil {
		t.Fatalf("record geography mistake: %v", err)
	}
	if _, err := store.ReclassifyMistake(ctx, other.Attempt.ID, cause.ID); !errors.Is(err, db.ErrInvalidErrorCause) {
		t.Fatalf("cross-subject reclassification error = %v, want ErrInvalidErrorCause", err)
	}
}

func TestStoreUpgradesSchemaVersionFifteenWithErrorCauseTaxonomy(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "legacy-v15.db")
	legacy, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("open legacy sqlite: %v", err)
	}
	if _, err := legacy.ExecContext(ctx, `
		CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
		INSERT INTO schema_migrations(version, applied_at) VALUES (15, '2026-08-20T00:00:00Z');
		CREATE TABLE lessons (id TEXT PRIMARY KEY, subject TEXT NOT NULL DEFAULT '', title TEXT NOT NULL,
			source_type TEXT NOT NULL DEFAULT '', source_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'draft',
			current_version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
		CREATE TABLE lesson_versions (lesson_id TEXT NOT NULL, version INTEGER NOT NULL,
			schema_version INTEGER NOT NULL DEFAULT 1, document_json TEXT NOT NULL, created_at TEXT NOT NULL,
			PRIMARY KEY (lesson_id, version));
		CREATE TABLE lesson_links (lesson_id TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT NOT NULL,
			created_at TEXT NOT NULL, PRIMARY KEY (lesson_id, target_type, target_id));
		CREATE TABLE lesson_attempts (id TEXT PRIMARY KEY, lesson_id TEXT NOT NULL, section_id TEXT NOT NULL,
			answer TEXT NOT NULL, evaluation TEXT NOT NULL, reference_answer TEXT NOT NULL DEFAULT '',
			feedback TEXT NOT NULL DEFAULT '', elapsed_ms INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
	`); err != nil {
		_ = legacy.Close()
		t.Fatalf("create legacy schema: %v", err)
	}
	if err := legacy.Close(); err != nil {
		t.Fatalf("close legacy sqlite: %v", err)
	}

	store, err := db.Open(ctx, path)
	if err != nil {
		t.Fatalf("upgrade version 15 store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	var tableCount, seedCount, markerCount int
	if err := store.SQL().QueryRowContext(ctx,
		`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'error_causes'`).Scan(&tableCount); err != nil {
		t.Fatalf("inspect error_causes: %v", err)
	}
	if err := store.SQL().QueryRowContext(ctx, `SELECT COUNT(*) FROM error_causes`).Scan(&seedCount); err != nil {
		t.Fatalf("count default error causes: %v", err)
	}
	if err := store.SQL().QueryRowContext(ctx,
		`SELECT COUNT(*) FROM schema_migrations WHERE version = ?`, db.SchemaVersion).Scan(&markerCount); err != nil {
		t.Fatalf("inspect migration marker: %v", err)
	}
	if tableCount != 1 || seedCount != 6 || markerCount != 1 {
		t.Fatalf("migration table=%d seeds=%d marker=%d", tableCount, seedCount, markerCount)
	}
}
