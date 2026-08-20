package db_test

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
	"time"

	"study-os/backend/db"
	"study-os/backend/models"

	_ "modernc.org/sqlite"
)

func TestQuestionAttemptSchemaHeadStoresCorrectionEvidence(t *testing.T) {
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "study.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	if db.SchemaVersion != 16 {
		t.Fatalf("schema version = %d, want 16", db.SchemaVersion)
	}
	for _, column := range []string{"answer", "elapsed_ms", "is_correct"} {
		var count int
		if err := store.SQL().QueryRowContext(ctx,
			`SELECT COUNT(*) FROM pragma_table_info('question_attempts') WHERE name = ?`, column,
		).Scan(&count); err != nil {
			t.Fatalf("inspect %s: %v", column, err)
		}
		if count != 1 {
			t.Fatalf("question_attempts.%s count = %d, want 1", column, count)
		}
	}
}

func TestStoreUpgradesLegacyCorrectionIntoEvidenceColumns(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "legacy-v14.db")
	legacy, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("open legacy sqlite: %v", err)
	}
	if _, err := legacy.ExecContext(ctx, `
		CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
		INSERT INTO schema_migrations(version, applied_at) VALUES (14, '2026-08-20T00:00:00Z');
		CREATE TABLE questions (id TEXT PRIMARY KEY, subject TEXT NOT NULL DEFAULT '', stem TEXT NOT NULL,
			source_id TEXT NOT NULL DEFAULT '', knowledge_item_id TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
		CREATE TABLE question_attempts (id TEXT PRIMARY KEY, question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
			cause TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', occurred_at TEXT NOT NULL);
		INSERT INTO questions(id, subject, stem, created_at) VALUES ('q-legacy', 'physics', 'F = ma', '2026-08-20T00:00:00Z');
		INSERT INTO question_attempts(id, question_id, cause, note, occurred_at)
			VALUES ('qa-wrong', 'q-legacy', 'method', '', '2026-08-20T00:00:00Z');
		INSERT INTO question_attempts(id, question_id, cause, note, occurred_at)
			VALUES ('qa-correct', 'q-legacy', '', '', '2026-08-20T00:01:00Z');
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
		t.Fatalf("upgrade version 14 store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	for _, testCase := range []struct {
		id      string
		correct int
	}{
		{id: "qa-wrong", correct: 0},
		{id: "qa-correct", correct: 1},
	} {
		var answer string
		var elapsed, correct int
		if err := store.SQL().QueryRowContext(ctx,
			`SELECT answer, elapsed_ms, is_correct FROM question_attempts WHERE id = ?`, testCase.id,
		).Scan(&answer, &elapsed, &correct); err != nil {
			t.Fatalf("read migrated %s: %v", testCase.id, err)
		}
		if answer != "" || elapsed != 0 || correct != testCase.correct {
			t.Fatalf("migrated %s = answer %q elapsed %d correct %d", testCase.id, answer, elapsed, correct)
		}
	}
}

func TestRecordMistakeCorrectionStoresAndProjectsEvidence(t *testing.T) {
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "study.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	filed, err := store.RecordMistake(ctx, models.MistakeInput{
		Subject: "physics", Stem: "若 m=2、a=3，求 F。", Cause: "method",
		Answer: " 5 N ", ElapsedMS: 900,
	})
	if err != nil {
		t.Fatalf("record mistake: %v", err)
	}
	if filed.Attempt.Answer != "5 N" || filed.Attempt.ElapsedMS != 900 || filed.Attempt.IsCorrect {
		t.Fatalf("wrong attempt evidence = %#v", filed.Attempt)
	}

	correctedAt := time.Date(2026, 8, 20, 8, 30, 0, 0, time.UTC)
	corrected, err := store.RecordMistakeCorrection(ctx, filed.Attempt.ID, models.MistakeCorrectionInput{
		Answer: " 6 N ", ElapsedMS: 4200, OccurredAt: correctedAt,
	})
	if err != nil {
		t.Fatalf("record correction: %v", err)
	}
	if !corrected.Corrected || corrected.Correction == nil {
		t.Fatalf("correction projection missing: %#v", corrected)
	}
	if corrected.Correction.Answer != "6 N" || corrected.Correction.ElapsedMS != 4200 || !corrected.Correction.IsCorrect {
		t.Fatalf("correction evidence = %#v", corrected.Correction)
	}
	if !corrected.Correction.OccurredAt.Equal(correctedAt) {
		t.Fatalf("correction time = %s, want %s", corrected.Correction.OccurredAt, correctedAt)
	}

	again, err := store.RecordMistakeCorrection(ctx, filed.Attempt.ID, models.MistakeCorrectionInput{
		Answer: "7 N", ElapsedMS: 5000,
	})
	if err != nil {
		t.Fatalf("repeat correction: %v", err)
	}
	if again.Correction == nil || again.Correction.ID != corrected.Correction.ID || again.Correction.Answer != "6 N" {
		t.Fatalf("repeat correction changed evidence: first=%#v again=%#v", corrected.Correction, again.Correction)
	}
	var correctAttempts int
	if err := store.SQL().QueryRowContext(ctx,
		`SELECT COUNT(*) FROM question_attempts WHERE question_id = ? AND is_correct = 1`, filed.Question.ID,
	).Scan(&correctAttempts); err != nil {
		t.Fatalf("count corrections: %v", err)
	}
	if correctAttempts != 1 {
		t.Fatalf("correct attempts = %d, want 1", correctAttempts)
	}

	listed, err := store.ListMistakes(ctx, models.MistakeListOptions{Limit: 10})
	if err != nil {
		t.Fatalf("list mistakes: %v", err)
	}
	if len(listed) != 1 || listed[0].Correction == nil || listed[0].Correction.Answer != "6 N" {
		t.Fatalf("listed correction = %#v", listed)
	}
}

func TestRecordMistakeCorrectionRejectsMissingEvidence(t *testing.T) {
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "study.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	filed, err := store.RecordMistake(ctx, models.MistakeInput{Stem: "题目", Cause: "unknown"})
	if err != nil {
		t.Fatalf("record mistake: %v", err)
	}

	for _, testCase := range []struct {
		name  string
		input models.MistakeCorrectionInput
	}{
		{name: "empty answer", input: models.MistakeCorrectionInput{Answer: "   ", ElapsedMS: 1}},
		{name: "negative elapsed", input: models.MistakeCorrectionInput{Answer: "答案", ElapsedMS: -1}},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			if _, err := store.RecordMistakeCorrection(ctx, filed.Attempt.ID, testCase.input); err == nil {
				t.Fatal("expected invalid correction evidence to be rejected")
			}
		})
	}
}
