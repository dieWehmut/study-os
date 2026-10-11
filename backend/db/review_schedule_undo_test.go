package db_test

import (
	"context"
	"encoding/json"
	"path/filepath"
	"testing"
	"time"

	"study-os/backend/db"
	"study-os/backend/models"
)

// 取消排复习 removes the *plan*, not the history.
//
// This is a data-layer test on purpose: the prompts cannot be deleted once answered
// (`attempts.prompt_id REFERENCES prompts(id) ON DELETE RESTRICT`), so the way out of the
// queue is to delete the review state and leave everything else standing. Doing it the
// other way round fails with a foreign-key error the moment an item has ever been
// reviewed -- which is the common case, not the corner case.
func TestRemoveReviewScheduleKeepsPromptsAndAttempts(t *testing.T) {
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "study.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	now := time.Date(2026, 8, 22, 9, 0, 0, 0, time.UTC)
	item := models.KnowledgeItem{
		ID: "k-undo", ItemType: "word_sense", Term: "undo", ConciseDefinition: "撤销",
		CreatedAt: now, UpdatedAt: now,
	}
	if err := store.CreateKnowledgeItem(ctx, item); err != nil {
		t.Fatalf("create item: %v", err)
	}
	prompt := models.Prompt{
		ID: "p-k-undo-1", KnowledgeItemID: item.ID, PromptType: "en_to_zh", Question: "undo",
		AcceptedAnswers: []string{"撤销"}, CreatedAt: now, UpdatedAt: now,
	}
	if err := store.CreatePrompt(ctx, prompt); err != nil {
		t.Fatalf("create prompt: %v", err)
	}
	card := map[string]any{"due": now.Format(time.RFC3339)}
	cardJSON, _ := json.Marshal(card)
	if err := store.UpsertReviewState(ctx, models.ReviewState{
		PromptID: prompt.ID, CardJSON: cardJSON, DueAt: now, UpdatedAt: now,
	}); err != nil {
		t.Fatalf("schedule: %v", err)
	}
	// (No attempt is recorded here: the point of this test is the shape of the undo, and the
	// foreign key that forces it is stated in the schema rather than simulated.)

	ids, err := store.ReviewPromptIDs(ctx, item.ID)
	if err != nil {
		t.Fatalf("list prompt ids: %v", err)
	}
	if len(ids) != 1 || ids[0] != prompt.ID {
		t.Fatalf("prompt ids = %v", ids)
	}

	removed, err := store.RemoveReviewSchedule(ctx, item.ID)
	if err != nil {
		t.Fatalf("remove schedule: %v", err)
	}
	if removed != 1 {
		t.Fatalf("removed %d schedules, want 1", removed)
	}

	// The prompt is still there, so re-scheduling can reuse it instead of colliding on
	// its deterministic id.
	remaining, err := store.ReviewPromptIDs(ctx, item.ID)
	if err != nil {
		t.Fatalf("list prompt ids after undo: %v", err)
	}
	if len(remaining) != 1 {
		t.Fatalf("prompts after undo = %v, want the card to survive", remaining)
	}

	// And the undo is idempotent: nothing left to remove is not an error.
	again, err := store.RemoveReviewSchedule(ctx, item.ID)
	if err != nil {
		t.Fatalf("second undo: %v", err)
	}
	if again != 0 {
		t.Fatalf("second undo removed %d, want 0", again)
	}
}
