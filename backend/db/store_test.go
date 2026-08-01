package db_test

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"study-os/backend/db"
	"study-os/backend/models"
)

func TestStoreMigratesAndPersistsCoreRecordsAcrossReopen(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "study.db")
	now := time.Date(2026, 8, 1, 12, 30, 0, 123456000, time.UTC)

	store, err := db.Open(ctx, path)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}

	if err := store.SetSetting(ctx, "daily_limit", "20"); err != nil {
		t.Fatalf("set setting: %v", err)
	}
	item := models.KnowledgeItem{
		ID:                "knowledge-1",
		ItemType:          "word_sense",
		Term:              "abandon",
		PartOfSpeech:      "verb",
		ConciseDefinition: "放弃；抛弃",
		DetailedMarkdown:  "## abandon\n\nTo leave something behind.",
		Level:             "CET4",
		Tags:              []string{"core", "verb"},
		CreatedAt:         now,
		UpdatedAt:         now,
	}
	if err := store.CreateKnowledgeItem(ctx, item); err != nil {
		t.Fatalf("create knowledge item: %v", err)
	}
	prompt := models.Prompt{
		ID:              "prompt-1",
		KnowledgeItemID: item.ID,
		PromptType:      "en_to_zh",
		Question:        item.Term,
		AcceptedAnswers: []string{"放弃", "抛弃"},
		CreatedAt:       now,
		UpdatedAt:       now,
	}
	if err := store.CreatePrompt(ctx, prompt); err != nil {
		t.Fatalf("create prompt: %v", err)
	}
	state := models.ReviewState{
		PromptID:  prompt.ID,
		CardJSON:  json.RawMessage(`{"due":"2026-08-01T12:30:00Z"}`),
		DueAt:     now,
		UpdatedAt: now,
	}
	if err := store.UpsertReviewState(ctx, state); err != nil {
		t.Fatalf("upsert review state: %v", err)
	}
	attempt := models.Attempt{
		ID:                  "attempt-1",
		PromptID:            prompt.ID,
		Answer:              "放弃",
		OriginalEvaluation:  "correct",
		EffectiveEvaluation: "correct",
		Feedback:            "回答正确。",
		SchedulerRating:     3,
		PriorCardJSON:       json.RawMessage(`{"state":0}`),
		Familiarity:         intPointer(4),
		CreatedAt:           now,
		UpdatedAt:           now,
	}
	if err := store.CreateAttempt(ctx, attempt); err != nil {
		t.Fatalf("create attempt: %v", err)
	}
	attempt.EffectiveEvaluation = "partial"
	attempt.Feedback = "已按学习者修正更新。"
	attempt.SchedulerRating = 2
	attempt.UpdatedAt = now.Add(time.Second)
	if err := store.UpdateAttempt(ctx, attempt); err != nil {
		t.Fatalf("update attempt: %v", err)
	}
	job := models.AgentJob{
		ID:          "job-1",
		JobType:     "evaluate_answer",
		Provider:    "mock",
		State:       "queued",
		PayloadJSON: json.RawMessage(`{"attempt_id":"attempt-1"}`),
		Attempts:    0,
		NextRetryAt: now.Add(time.Minute),
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if err := store.CreateAgentJob(ctx, job); err != nil {
		t.Fatalf("create agent job: %v", err)
	}
	job.State = "retry_wait"
	job.Attempts = 1
	job.ErrorSummary = "provider unavailable"
	job.UpdatedAt = now.Add(time.Second)
	if err := store.UpdateAgentJob(ctx, job); err != nil {
		t.Fatalf("update agent job: %v", err)
	}
	event := models.DomainEvent{
		ID:          "event-1",
		EventType:   "attempt_recorded",
		AggregateID: attempt.ID,
		PayloadJSON: json.RawMessage(`{"outcome":"correct"}`),
		OccurredAt:  now,
	}
	if err := store.AppendDomainEvent(ctx, event); err != nil {
		t.Fatalf("append domain event: %v", err)
	}
	if err := store.Close(); err != nil {
		t.Fatalf("close store: %v", err)
	}

	reopened, err := db.Open(ctx, path)
	if err != nil {
		t.Fatalf("reopen store: %v", err)
	}
	t.Cleanup(func() { _ = reopened.Close() })

	assertSetting(t, ctx, reopened, "daily_limit", "20")
	storedItem, err := reopened.GetKnowledgeItem(ctx, item.ID)
	if err != nil {
		t.Fatalf("get knowledge item: %v", err)
	}
	if storedItem.Term != item.Term || storedItem.DetailedMarkdown != item.DetailedMarkdown || len(storedItem.Tags) != 2 {
		t.Fatalf("knowledge item changed after reopen: %#v", storedItem)
	}
	storedPrompt, err := reopened.GetPrompt(ctx, prompt.ID)
	if err != nil {
		t.Fatalf("get prompt: %v", err)
	}
	if storedPrompt.KnowledgeItemID != item.ID || len(storedPrompt.AcceptedAnswers) != 2 {
		t.Fatalf("prompt changed after reopen: %#v", storedPrompt)
	}
	storedState, err := reopened.GetReviewState(ctx, prompt.ID)
	if err != nil {
		t.Fatalf("get review state: %v", err)
	}
	if !storedState.DueAt.Equal(now) || string(storedState.CardJSON) != string(state.CardJSON) {
		t.Fatalf("review state changed after reopen: %#v", storedState)
	}
	due, err := reopened.DuePrompts(ctx, now.Add(time.Second), 10)
	if err != nil {
		t.Fatalf("get due prompts: %v", err)
	}
	if len(due) != 1 || due[0].ID != prompt.ID {
		t.Fatalf("due prompts = %#v", due)
	}
	storedAttempt, err := reopened.GetAttempt(ctx, attempt.ID)
	if err != nil {
		t.Fatalf("get attempt: %v", err)
	}
	if storedAttempt.Feedback != attempt.Feedback || storedAttempt.EffectiveEvaluation != "partial" || storedAttempt.Familiarity == nil || *storedAttempt.Familiarity != 4 {
		t.Fatalf("attempt changed after reopen: %#v", storedAttempt)
	}
	storedJob, err := reopened.GetAgentJob(ctx, job.ID)
	if err != nil {
		t.Fatalf("get agent job: %v", err)
	}
	if storedJob.Provider != "mock" || storedJob.State != "retry_wait" || storedJob.Attempts != 1 || storedJob.ErrorSummary == "" {
		t.Fatalf("agent job changed after reopen: %#v", storedJob)
	}
	events, err := reopened.ListDomainEvents(ctx, 10)
	if err != nil {
		t.Fatalf("list domain events: %v", err)
	}
	if len(events) != 1 || events[0].ID != event.ID || !events[0].OccurredAt.Equal(now) {
		t.Fatalf("events changed after reopen: %#v", events)
	}
}

func TestWithTxRollsBackAllWritesOnError(t *testing.T) {
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "study.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	sentinel := errors.New("abort review")
	err = store.WithTx(ctx, func(tx *db.TxStore) error {
		if err := tx.SetSetting(ctx, "transient", "value"); err != nil {
			return err
		}
		return sentinel
	})
	if !errors.Is(err, sentinel) {
		t.Fatalf("transaction error = %v, want %v", err, sentinel)
	}
	if _, err := store.GetSetting(ctx, "transient"); !errors.Is(err, db.ErrNotFound) {
		t.Fatalf("rolled-back setting lookup error = %v, want ErrNotFound", err)
	}
}

func TestStoreAppliesMigrationsOnceAndEnablesSQLiteSafetyPragmas(t *testing.T) {
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "study.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	var migrationCount int
	if err := store.SQL().QueryRowContext(ctx, `SELECT COUNT(*) FROM schema_migrations`).Scan(&migrationCount); err != nil {
		t.Fatalf("count migrations: %v", err)
	}
	if migrationCount != 1 {
		t.Fatalf("migration count = %d, want 1", migrationCount)
	}

	var foreignKeys int
	if err := store.SQL().QueryRowContext(ctx, `PRAGMA foreign_keys`).Scan(&foreignKeys); err != nil {
		t.Fatalf("foreign keys pragma: %v", err)
	}
	if foreignKeys != 1 {
		t.Fatalf("foreign_keys = %d, want 1", foreignKeys)
	}
	var journalMode string
	if err := store.SQL().QueryRowContext(ctx, `PRAGMA journal_mode`).Scan(&journalMode); err != nil {
		t.Fatalf("journal mode pragma: %v", err)
	}
	if journalMode != "wal" {
		t.Fatalf("journal_mode = %q, want wal", journalMode)
	}
	var busyTimeout int
	if err := store.SQL().QueryRowContext(ctx, `PRAGMA busy_timeout`).Scan(&busyTimeout); err != nil {
		t.Fatalf("busy timeout pragma: %v", err)
	}
	if busyTimeout < 5000 {
		t.Fatalf("busy_timeout = %d, want at least 5000", busyTimeout)
	}
}

func TestFixturesAreSeededOnlyWhenExplicitlyRequested(t *testing.T) {
	ctx := context.Background()
	plain, err := db.Open(ctx, filepath.Join(t.TempDir(), "plain.db"))
	if err != nil {
		t.Fatalf("open plain store: %v", err)
	}
	items, err := plain.ListKnowledgeItems(ctx, models.KnowledgeListOptions{})
	if err != nil {
		t.Fatalf("list plain items: %v", err)
	}
	_ = plain.Close()
	if len(items) != 0 {
		t.Fatalf("default store seeded %d fixtures", len(items))
	}

	seeded, err := db.Open(ctx, filepath.Join(t.TempDir(), "seeded.db"), db.WithFixtureSeed())
	if err != nil {
		t.Fatalf("open seeded store: %v", err)
	}
	t.Cleanup(func() { _ = seeded.Close() })
	items, err = seeded.ListKnowledgeItems(ctx, models.KnowledgeListOptions{})
	if err != nil {
		t.Fatalf("list seeded items: %v", err)
	}
	if len(items) == 0 {
		t.Fatal("explicit fixture seed produced no knowledge items")
	}
}

func assertSetting(t *testing.T, ctx context.Context, store *db.Store, key, want string) {
	t.Helper()
	got, err := store.GetSetting(ctx, key)
	if err != nil {
		t.Fatalf("get setting %q: %v", key, err)
	}
	if got != want {
		t.Fatalf("setting %q = %q, want %q", key, got, want)
	}
}

func intPointer(value int) *int { return &value }
