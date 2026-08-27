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

func TestKnowledgeMasteryUsesLatestEffectiveEvaluationAndKeepsSensesIsolated(t *testing.T) {
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "study.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	now := time.Date(2026, 8, 24, 10, 0, 0, 0, time.UTC)
	for _, item := range []models.KnowledgeItem{
		{ID: "sense-address-location", ItemType: "word_sense", Subject: "english", Term: "address", ConciseDefinition: "地址", CreatedAt: now, UpdatedAt: now},
		{ID: "sense-address-handle", ItemType: "word_sense", Subject: "english", Term: "address", ConciseDefinition: "处理", CreatedAt: now, UpdatedAt: now},
	} {
		if err := store.CreateKnowledgeItem(ctx, item); err != nil {
			t.Fatalf("create knowledge item %s: %v", item.ID, err)
		}
	}

	for _, prompt := range []models.Prompt{
		{ID: "location-recognition", KnowledgeItemID: "sense-address-location", PromptType: "en_to_zh", Question: "address", CreatedAt: now, UpdatedAt: now},
		{ID: "location-comprehension", KnowledgeItemID: "sense-address-location", PromptType: "context_cloze", Question: "Write your _____ here.", CreatedAt: now, UpdatedAt: now},
		{ID: "handle-retrieval", KnowledgeItemID: "sense-address-handle", PromptType: "zh_to_en", Question: "处理", CreatedAt: now, UpdatedAt: now},
	} {
		if err := store.CreatePrompt(ctx, prompt); err != nil {
			t.Fatalf("create prompt %s: %v", prompt.ID, err)
		}
		if err := store.UpsertReviewState(ctx, models.ReviewState{
			PromptID: prompt.ID, CardJSON: json.RawMessage(`{"state":0}`), DueAt: now.Add(24 * time.Hour), UpdatedAt: now,
		}); err != nil {
			t.Fatalf("create review state %s: %v", prompt.ID, err)
		}
	}

	for _, attempt := range []models.Attempt{
		{
			ID: "location-attempt-old", PromptID: "location-recognition", Answer: "地址",
			OriginalEvaluation: "correct", EffectiveEvaluation: "correct", Feedback: "correct",
			SchedulerRating: 3, PriorCardJSON: json.RawMessage(`{"state":0}`), CreatedAt: now, UpdatedAt: now,
		},
		{
			ID: "location-attempt-latest", PromptID: "location-recognition", Answer: "住址",
			OriginalEvaluation: "correct", EffectiveEvaluation: "partial", Feedback: "overridden",
			SchedulerRating: 2, PriorCardJSON: json.RawMessage(`{"state":1}`), CreatedAt: now.Add(time.Minute), UpdatedAt: now.Add(time.Minute),
		},
		{
			ID: "handle-attempt", PromptID: "handle-retrieval", Answer: "address",
			OriginalEvaluation: "correct", EffectiveEvaluation: "correct", Feedback: "correct",
			SchedulerRating: 3, PriorCardJSON: json.RawMessage(`{"state":0}`), CreatedAt: now.Add(2 * time.Minute), UpdatedAt: now.Add(2 * time.Minute),
		},
	} {
		if err := store.CreateAttempt(ctx, attempt); err != nil {
			t.Fatalf("create attempt %s: %v", attempt.ID, err)
		}
	}

	projection, err := store.GetKnowledgeMastery(ctx, "sense-address-location")
	if err != nil {
		t.Fatalf("get mastery: %v", err)
	}
	if projection.KnowledgeItemID != "sense-address-location" {
		t.Fatalf("knowledge id = %q", projection.KnowledgeItemID)
	}
	recognition := projection.Dimensions[0]
	if recognition.State != models.MasteryStatePartial || recognition.AttemptCount != 2 || recognition.LatestOutcome != "partial" {
		t.Fatalf("recognition = %#v", recognition)
	}
	if recognition.EvidenceKind != models.MasteryEvidenceAnswer {
		t.Fatalf("recognition evidence kind = %q", recognition.EvidenceKind)
	}
	if projection.Dimensions[1].State != models.MasteryStateUntested {
		t.Fatalf("comprehension = %#v", projection.Dimensions[1])
	}
	if projection.Dimensions[2].State != models.MasteryStateMissing {
		t.Fatalf("retrieval leaked from another sense: %#v", projection.Dimensions[2])
	}
}
