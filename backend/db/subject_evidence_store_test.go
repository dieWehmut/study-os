package db_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"path/filepath"
	"testing"

	"study-os/backend/db"
	"study-os/backend/models"
)

func TestMistakeStorePersistsAndUpdatesSubjectEvidence(t *testing.T) {
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "study.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	initial := json.RawMessage(`{"version":1,"subject":"math","tool":"derivation","data":{"lines":["2x+4=10","2x=6","x=3"]}}`)
	filed, err := store.RecordMistake(ctx, models.MistakeInput{
		Subject: "math", Stem: "解方程", Cause: "method", EvidenceJSON: initial,
	})
	if err != nil {
		t.Fatalf("record mistake: %v", err)
	}
	if string(filed.Attempt.EvidenceJSON) == "" || string(filed.Attempt.EvidenceJSON) == "{}" {
		t.Fatalf("filed evidence = %s", filed.Attempt.EvidenceJSON)
	}

	updatedRaw := json.RawMessage(`{"version":1,"subject":"math","tool":"derivation","data":{"lines":["x+4=10","x=6"]}}`)
	updated, err := store.UpdateMistakeEvidence(ctx, filed.Attempt.ID, updatedRaw)
	if err != nil {
		t.Fatalf("update evidence: %v", err)
	}
	if string(updated.Attempt.EvidenceJSON) == string(filed.Attempt.EvidenceJSON) {
		t.Fatalf("evidence did not change: %s", updated.Attempt.EvidenceJSON)
	}

	listed, err := store.ListMistakes(ctx, models.MistakeListOptions{Subject: "math"})
	if err != nil {
		t.Fatalf("list mistakes: %v", err)
	}
	if len(listed) != 1 || string(listed[0].Attempt.EvidenceJSON) != string(updated.Attempt.EvidenceJSON) {
		t.Fatalf("listed = %#v", listed)
	}
}

func TestMistakeStoreRejectsEvidenceForAnotherSubject(t *testing.T) {
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "study.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	filed, err := store.RecordMistake(ctx, models.MistakeInput{Subject: "chinese", Stem: "赏析", Cause: "method"})
	if err != nil {
		t.Fatalf("record mistake: %v", err)
	}
	physics := json.RawMessage(`{"version":1,"subject":"physics","tool":"free_body","data":{"forces":[{"id":"g","name":"重力","magnitude":10,"angle":270,"kind":"field"}]}}`)
	if _, err := store.UpdateMistakeEvidence(ctx, filed.Attempt.ID, physics); !errors.Is(err, db.ErrInvalidMistakeEvidence) {
		t.Fatalf("update error = %v, want ErrInvalidMistakeEvidence", err)
	}
}

func TestStoreUpgradesSchemaVersionSeventeenWithSubjectEvidence(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "legacy-v17.db")
	store, err := db.Open(ctx, path)
	if err != nil {
		t.Fatalf("create current store: %v", err)
	}
	if _, err := store.RecordMistake(ctx, models.MistakeInput{Subject: "math", Stem: "旧错题", Cause: "method"}); err != nil {
		_ = store.Close()
		t.Fatalf("seed mistake: %v", err)
	}
	if err := store.Close(); err != nil {
		t.Fatalf("close current store: %v", err)
	}

	legacy, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("open legacy sqlite: %v", err)
	}
	if _, err := legacy.ExecContext(ctx, `DELETE FROM schema_migrations WHERE version = 18`); err != nil {
		_ = legacy.Close()
		t.Fatalf("remove version 18 marker: %v", err)
	}
	if _, err := legacy.ExecContext(ctx, `INSERT INTO schema_migrations(version, applied_at) VALUES (17, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`); err != nil {
		_ = legacy.Close()
		t.Fatalf("insert version 17 marker: %v", err)
	}
	if _, err := legacy.ExecContext(ctx, `ALTER TABLE question_attempts DROP COLUMN evidence_json`); err != nil {
		_ = legacy.Close()
		t.Fatalf("downgrade fixture: %v", err)
	}
	if err := legacy.Close(); err != nil {
		t.Fatalf("close legacy sqlite: %v", err)
	}

	upgraded, err := db.Open(ctx, path)
	if err != nil {
		t.Fatalf("upgrade v17 store: %v", err)
	}
	t.Cleanup(func() { _ = upgraded.Close() })
	var columnCount int
	if err := upgraded.SQL().QueryRowContext(ctx, `SELECT COUNT(*) FROM pragma_table_info('question_attempts') WHERE name = 'evidence_json'`).Scan(&columnCount); err != nil {
		t.Fatalf("inspect evidence column: %v", err)
	}
	if columnCount != 1 {
		t.Fatalf("evidence_json column count = %d, want 1", columnCount)
	}
	listed, err := upgraded.ListMistakes(ctx, models.MistakeListOptions{Subject: "math"})
	if err != nil {
		t.Fatalf("list upgraded mistakes: %v", err)
	}
	if len(listed) != 1 || string(listed[0].Attempt.EvidenceJSON) != "{}" {
		t.Fatalf("upgraded mistakes = %#v", listed)
	}
}

func TestStoreRejectsSchemaWithOnlyOneQuestionTable(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "broken-question-schema.db")
	store, err := db.Open(ctx, path)
	if err != nil {
		t.Fatalf("create current store: %v", err)
	}
	if err := store.Close(); err != nil {
		t.Fatalf("close current store: %v", err)
	}

	broken, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("open broken sqlite: %v", err)
	}
	if _, err := broken.ExecContext(ctx, `DROP TABLE question_attempts`); err != nil {
		_ = broken.Close()
		t.Fatalf("drop question_attempts: %v", err)
	}
	if err := broken.Close(); err != nil {
		t.Fatalf("close broken sqlite: %v", err)
	}

	if reopened, err := db.Open(ctx, path); err == nil {
		_ = reopened.Close()
		t.Fatal("expected incomplete question schema to be rejected")
	}
}
