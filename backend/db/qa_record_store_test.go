package db_test

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"study-os/backend/db"
	"study-os/backend/models"

	_ "modernc.org/sqlite"
)

func TestQARecordValidateRejectsInvalidStatusAndContext(t *testing.T) {
	valid := models.QARecord{
		ID:                    "qa-1",
		SessionID:             "session-1",
		Subject:               "physics",
		OriginalUnderstanding: "Force causes motion.",
		CorrectedModel:        "Net force causes acceleration.",
		MasteryEvidence:       "I can apply F = ma to a new example.",
		Status:                models.QARecordStatusOpen,
	}
	if err := valid.Validate(); err != nil {
		t.Fatalf("valid record rejected: %v", err)
	}

	tests := []struct {
		name   string
		mutate func(*models.QARecord)
		want   string
	}{
		{name: "missing id", mutate: func(record *models.QARecord) { record.ID = "" }, want: "id"},
		{name: "missing session", mutate: func(record *models.QARecord) { record.SessionID = "" }, want: "session"},
		{name: "missing subject", mutate: func(record *models.QARecord) { record.Subject = "" }, want: "subject"},
		{name: "invalid status", mutate: func(record *models.QARecord) { record.Status = "complete" }, want: "status"},
		{name: "context type without id", mutate: func(record *models.QARecord) { record.ContextType = models.QARecordContextKnowledgeItem }, want: "together"},
		{name: "context id without type", mutate: func(record *models.QARecord) { record.ContextID = "knowledge-1" }, want: "together"},
		{name: "invalid context type", mutate: func(record *models.QARecord) {
			record.ContextType = "prompt"
			record.ContextID = "prompt-1"
		}, want: "context type"},
	}
	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			record := valid
			testCase.mutate(&record)
			err := record.Validate()
			if err == nil || !strings.Contains(err.Error(), testCase.want) {
				t.Fatalf("Validate() error = %v, want substring %q", err, testCase.want)
			}
		})
	}
}

func TestQARecordUpsertPersistsAndPreservesIdentity(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "study.db")
	store, err := db.Open(ctx, path)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	if db.SchemaVersion != 17 {
		t.Fatalf("schema version = %d, want 17", db.SchemaVersion)
	}
	createChatSession(t, ctx, store, "session-qa", "physics")

	created, err := store.UpsertQARecord(ctx, models.QARecord{
		ID:                    "qa-record-1",
		SessionID:             "session-qa",
		Subject:               "physics",
		OriginalUnderstanding: "A larger force always means a larger velocity.",
		CorrectedModel:        "Net force controls acceleration, not velocity directly.",
		MasteryEvidence:       "I predicted the acceleration in a new case.",
		Unresolved:            "How does drag change the model?",
		Status:                models.QARecordStatusOpen,
	})
	if err != nil {
		_ = store.Close()
		t.Fatalf("create qa record: %v", err)
	}
	if created.ID != "qa-record-1" || created.CreatedAt.IsZero() || created.UpdatedAt.IsZero() {
		_ = store.Close()
		t.Fatalf("created record = %#v", created)
	}

	time.Sleep(2 * time.Millisecond)
	updated, err := store.UpsertQARecord(ctx, models.QARecord{
		ID:                    "ignored-replacement-id",
		SessionID:             "session-qa",
		Subject:               "physics",
		OriginalUnderstanding: created.OriginalUnderstanding,
		CorrectedModel:        "The vector sum of forces determines acceleration.",
		MasteryEvidence:       "Solved an inclined-plane transfer question.",
		Status:                models.QARecordStatusUnderstood,
	})
	if err != nil {
		_ = store.Close()
		t.Fatalf("update qa record: %v", err)
	}
	if updated.ID != created.ID {
		_ = store.Close()
		t.Fatalf("updated id = %q, want %q", updated.ID, created.ID)
	}
	if !updated.CreatedAt.Equal(created.CreatedAt) {
		_ = store.Close()
		t.Fatalf("updated created_at = %v, want %v", updated.CreatedAt, created.CreatedAt)
	}
	if !updated.UpdatedAt.After(created.UpdatedAt) {
		_ = store.Close()
		t.Fatalf("updated_at = %v, want after %v", updated.UpdatedAt, created.UpdatedAt)
	}
	if updated.Status != models.QARecordStatusUnderstood || updated.Unresolved != "" {
		_ = store.Close()
		t.Fatalf("updated record = %#v", updated)
	}
	if err := store.Close(); err != nil {
		t.Fatalf("close store: %v", err)
	}

	reopened, err := db.Open(ctx, path)
	if err != nil {
		t.Fatalf("reopen store: %v", err)
	}
	t.Cleanup(func() { _ = reopened.Close() })
	got, err := reopened.GetQARecord(ctx, "session-qa")
	if err != nil {
		t.Fatalf("get reopened qa record: %v", err)
	}
	if got.ID != created.ID || got.CorrectedModel != updated.CorrectedModel || got.Status != models.QARecordStatusUnderstood {
		t.Fatalf("reopened record = %#v", got)
	}
	if !got.CreatedAt.Equal(created.CreatedAt) || !got.UpdatedAt.Equal(updated.UpdatedAt) {
		t.Fatalf("reopened timestamps = (%v, %v), want (%v, %v)", got.CreatedAt, got.UpdatedAt, created.CreatedAt, updated.UpdatedAt)
	}
}

func TestQARecordUpsertRequiresChatSessionAndExistingContext(t *testing.T) {
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "study.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	base := models.QARecord{
		ID:        "qa-context",
		SessionID: "missing-session",
		Subject:   "physics",
		Status:    models.QARecordStatusFollowUp,
	}
	if _, err := store.UpsertQARecord(ctx, base); !errors.Is(err, db.ErrNotFound) {
		t.Fatalf("missing session error = %v, want ErrNotFound", err)
	}

	createChatSession(t, ctx, store, "session-context", "physics")
	base.SessionID = "session-context"
	base.ContextType = models.QARecordContextKnowledgeItem
	base.ContextID = "missing-target"
	if _, err := store.UpsertQARecord(ctx, base); !errors.Is(err, db.ErrNotFound) {
		t.Fatalf("missing context error = %v, want ErrNotFound", err)
	}

	if _, err := store.UpsertQARecord(ctx, models.QARecord{
		ID: "qa-invalid", SessionID: "session-context", Subject: "physics", Status: "complete",
	}); err == nil || !strings.Contains(err.Error(), "status") {
		t.Fatalf("invalid status error = %v", err)
	}
	if _, err := store.UpsertQARecord(ctx, models.QARecord{
		ID: "qa-unpaired", SessionID: "session-context", Subject: "physics", ContextType: models.QARecordContextLesson,
		Status: models.QARecordStatusOpen,
	}); err == nil || !strings.Contains(err.Error(), "together") {
		t.Fatalf("unpaired context error = %v", err)
	}
}

func TestQARecordUpsertAcceptsEveryContextType(t *testing.T) {
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "study.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	if _, err := store.SQL().ExecContext(ctx, `
		INSERT INTO knowledge_items(id, item_type, term, concise_definition, created_at, updated_at)
		VALUES ('knowledge-context', 'concept', 'Force', 'A push or pull', ?, ?);
		INSERT INTO questions(id, stem, created_at) VALUES ('question-context', 'What is force?', ?);
		INSERT INTO lessons(id, title, created_at, updated_at) VALUES ('lesson-context', 'Forces', ?, ?);`,
		"2026-08-21T00:00:00Z", "2026-08-21T00:00:00Z", "2026-08-21T00:00:00Z",
		"2026-08-21T00:00:00Z", "2026-08-21T00:00:00Z"); err != nil {
		t.Fatalf("seed context targets: %v", err)
	}

	tests := []struct {
		contextType string
		contextID   string
	}{
		{contextType: models.QARecordContextKnowledgeItem, contextID: "knowledge-context"},
		{contextType: models.QARecordContextQuestion, contextID: "question-context"},
		{contextType: models.QARecordContextLesson, contextID: "lesson-context"},
	}
	for index, testCase := range tests {
		sessionID := "session-context-" + testCase.contextType
		createChatSession(t, ctx, store, sessionID, "physics")
		created, err := store.UpsertQARecord(ctx, models.QARecord{
			ID: "qa-context-" + testCase.contextType, SessionID: sessionID,
			Subject:     "physics",
			ContextType: testCase.contextType, ContextID: testCase.contextID,
			Status: models.QARecordStatusOpen,
		})
		if err != nil {
			t.Fatalf("context case %d (%s): %v", index, testCase.contextType, err)
		}
		if created.ContextType != testCase.contextType || created.ContextID != testCase.contextID {
			t.Fatalf("context case %d = %#v", index, created)
		}
	}
}

func TestStoreUpgradesSchemaVersionSixteenWithQARecords(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "legacy-v16.db")
	legacy, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("open legacy sqlite: %v", err)
	}
	if _, err := legacy.ExecContext(ctx, `
		CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
		INSERT INTO schema_migrations(version, applied_at) VALUES (16, '2026-08-20T00:00:00Z');
		CREATE TABLE chat_messages (
			id TEXT PRIMARY KEY, session_id TEXT NOT NULL DEFAULT '', subject TEXT NOT NULL DEFAULT '',
			role TEXT NOT NULL, content TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
			error_summary TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
		);
		CREATE TABLE lessons (
			id TEXT PRIMARY KEY, subject TEXT NOT NULL DEFAULT '', title TEXT NOT NULL,
			source_type TEXT NOT NULL DEFAULT '', source_id TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL DEFAULT 'draft', current_version INTEGER NOT NULL DEFAULT 1,
			created_at TEXT NOT NULL, updated_at TEXT NOT NULL
		);
		CREATE TABLE lesson_versions (
			lesson_id TEXT NOT NULL, version INTEGER NOT NULL, schema_version INTEGER NOT NULL DEFAULT 1,
			document_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (lesson_id, version)
		);
		CREATE TABLE lesson_links (
			lesson_id TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT NOT NULL,
			created_at TEXT NOT NULL, PRIMARY KEY (lesson_id, target_type, target_id)
		);
		CREATE TABLE lesson_attempts (
			id TEXT PRIMARY KEY, lesson_id TEXT NOT NULL, section_id TEXT NOT NULL, answer TEXT NOT NULL,
			evaluation TEXT NOT NULL, reference_answer TEXT NOT NULL DEFAULT '', feedback TEXT NOT NULL DEFAULT '',
			elapsed_ms INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
		);
		CREATE TABLE error_causes (
			id TEXT PRIMARY KEY, subject TEXT NOT NULL DEFAULT '', parent_id TEXT,
			label TEXT NOT NULL, review_fixes INTEGER NOT NULL DEFAULT 0, action TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL DEFAULT 'candidate', source_type TEXT NOT NULL DEFAULT '',
			source_id TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL, updated_at TEXT NOT NULL
		);
	`); err != nil {
		_ = legacy.Close()
		t.Fatalf("create legacy schema: %v", err)
	}
	if err := legacy.Close(); err != nil {
		t.Fatalf("close legacy sqlite: %v", err)
	}

	store, err := db.Open(ctx, path)
	if err != nil {
		t.Fatalf("upgrade version 16 store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	var tableCount, indexCount, migrationCount int
	if err := store.SQL().QueryRowContext(ctx, `SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'qa_records'`).Scan(&tableCount); err != nil {
		t.Fatalf("inspect qa_records: %v", err)
	}
	if err := store.SQL().QueryRowContext(ctx, `SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'qa_records_session_idx'`).Scan(&indexCount); err != nil {
		t.Fatalf("inspect qa record index: %v", err)
	}
	if err := store.SQL().QueryRowContext(ctx, `SELECT COUNT(*) FROM schema_migrations WHERE version = 17`).Scan(&migrationCount); err != nil {
		t.Fatalf("inspect migration marker: %v", err)
	}
	if tableCount != 1 || indexCount != 1 || migrationCount != 1 {
		t.Fatalf("migration objects table=%d index=%d marker=%d", tableCount, indexCount, migrationCount)
	}
}

func TestStoreRejectsSchemaVersionSeventeenWithoutQARecordSessionIndex(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "corrupt-v17.db")
	store, err := db.Open(ctx, path)
	if err != nil {
		t.Fatalf("create version 17 store: %v", err)
	}
	if err := store.Close(); err != nil {
		t.Fatalf("close version 17 store: %v", err)
	}

	corrupt, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("open version 17 sqlite: %v", err)
	}
	if _, err := corrupt.ExecContext(ctx, `DROP INDEX qa_records_session_idx`); err != nil {
		_ = corrupt.Close()
		t.Fatalf("drop qa record session index: %v", err)
	}
	if err := corrupt.Close(); err != nil {
		t.Fatalf("close corrupt sqlite: %v", err)
	}

	reopened, err := db.Open(ctx, path)
	if reopened != nil {
		_ = reopened.Close()
	}
	if err == nil || !strings.Contains(err.Error(), "qa_records_session_idx") {
		t.Fatalf("open error = %v, want missing qa_records_session_idx", err)
	}
}

func TestStoreRejectsSchemaVersionSeventeenWithMissingQARecordColumn(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "corrupt-v17.db")
	store, err := db.Open(ctx, path)
	if err != nil {
		t.Fatalf("create version 17 store: %v", err)
	}
	if err := store.Close(); err != nil {
		t.Fatalf("close version 17 store: %v", err)
	}

	corrupt, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("open version 17 sqlite: %v", err)
	}
	if _, err := corrupt.ExecContext(ctx, `ALTER TABLE qa_records DROP COLUMN mastery_evidence`); err != nil {
		_ = corrupt.Close()
		t.Fatalf("drop qa record column: %v", err)
	}
	if err := corrupt.Close(); err != nil {
		t.Fatalf("close corrupt sqlite: %v", err)
	}

	reopened, err := db.Open(ctx, path)
	if reopened != nil {
		_ = reopened.Close()
	}
	if err == nil || !strings.Contains(err.Error(), "qa_records.mastery_evidence") {
		t.Fatalf("open error = %v, want missing qa_records.mastery_evidence", err)
	}
}

func createChatSession(t *testing.T, ctx context.Context, store *db.Store, sessionID, subject string) {
	t.Helper()
	if err := store.CreateChatMessage(ctx, models.ChatMessage{
		ID: "message-" + sessionID, SessionID: sessionID, Subject: subject,
		Role: "user", Content: "Explain this.", Status: "done",
	}); err != nil {
		t.Fatalf("create chat session %q: %v", sessionID, err)
	}
}
