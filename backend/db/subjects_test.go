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

func TestKnowledgeItemsAndDuePromptsFilterBySubject(t *testing.T) {
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "study.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	now := time.Date(2026, 8, 3, 12, 0, 0, 0, time.UTC)
	for _, item := range []models.KnowledgeItem{
		{ID: "k-en", ItemType: "word_sense", Term: "abandon", ConciseDefinition: "放弃", Subject: "english", CreatedAt: now, UpdatedAt: now},
		{ID: "k-math", ItemType: "word_sense", Term: "derivative", ConciseDefinition: "导数", Subject: "math", CreatedAt: now, UpdatedAt: now},
	} {
		if err := store.CreateKnowledgeItem(ctx, item); err != nil {
			t.Fatalf("create item: %v", err)
		}
	}

	english, err := store.ListKnowledgeItems(ctx, models.KnowledgeListOptions{Subject: "english"})
	if err != nil {
		t.Fatalf("list english: %v", err)
	}
	if len(english) != 1 || english[0].ID != "k-en" || english[0].Subject != "english" {
		t.Fatalf("english items = %#v", english)
	}
	math, err := store.ListKnowledgeItems(ctx, models.KnowledgeListOptions{Subject: "math"})
	if err != nil {
		t.Fatalf("list math: %v", err)
	}
	if len(math) != 1 || math[0].ID != "k-math" {
		t.Fatalf("math items = %#v", math)
	}

	for index, item := range []models.KnowledgeItem{{ID: "k-en"}, {ID: "k-math"}} {
		prompt := models.Prompt{
			ID:              "prompt-" + item.ID,
			KnowledgeItemID: item.ID,
			PromptType:      "en_to_zh",
			Question:        "q",
			AcceptedAnswers: []string{"a"},
			CreatedAt:       now.Add(time.Duration(index) * time.Second),
			UpdatedAt:       now.Add(time.Duration(index) * time.Second),
		}
		if err := store.CreatePrompt(ctx, prompt); err != nil {
			t.Fatalf("create prompt: %v", err)
		}
		if err := store.UpsertReviewState(ctx, models.ReviewState{
			PromptID:  prompt.ID,
			CardJSON:  json.RawMessage(`{"due":"2026-08-03T12:00:00Z"}`),
			DueAt:     now,
			UpdatedAt: now,
		}); err != nil {
			t.Fatalf("upsert review state: %v", err)
		}
	}

	dueEnglish, err := store.DuePromptsWithOptions(ctx, now.Add(time.Minute), db.DuePromptOptions{Subject: "english"})
	if err != nil {
		t.Fatalf("due english: %v", err)
	}
	if len(dueEnglish) != 1 || dueEnglish[0].KnowledgeItemID != "k-en" {
		t.Fatalf("due english = %#v", dueEnglish)
	}
	dueAll, err := store.DuePromptsWithOptions(ctx, now.Add(time.Minute), db.DuePromptOptions{})
	if err != nil {
		t.Fatalf("due all: %v", err)
	}
	if len(dueAll) != 2 {
		t.Fatalf("due all = %d, want 2", len(dueAll))
	}
}
