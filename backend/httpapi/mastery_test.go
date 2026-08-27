package httpapi_test

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"study-os/backend/config"
	"study-os/backend/httpapi"
	"study-os/backend/models"
)

func TestKnowledgeMasteryReturnsFourEnglishDimensions(t *testing.T) {
	application := testApplication(t, config.Config{})
	now := time.Date(2026, 8, 24, 10, 0, 0, 0, time.UTC)
	if err := application.Store.CreateKnowledgeItem(t.Context(), models.KnowledgeItem{
		ID: "sense-abandon", ItemType: "word_sense", Subject: "english", Term: "abandon",
		ConciseDefinition: "放弃", CreatedAt: now, UpdatedAt: now,
	}); err != nil {
		t.Fatalf("create knowledge item: %v", err)
	}
	if err := application.Store.CreatePrompt(t.Context(), models.Prompt{
		ID: "abandon-recognition", KnowledgeItemID: "sense-abandon", PromptType: "en_to_zh",
		Question: "abandon", CreatedAt: now, UpdatedAt: now,
	}); err != nil {
		t.Fatalf("create prompt: %v", err)
	}
	if err := application.Store.UpsertReviewState(t.Context(), models.ReviewState{
		PromptID: "abandon-recognition", CardJSON: json.RawMessage(`{"state":0}`),
		DueAt: now.Add(24 * time.Hour), UpdatedAt: now,
	}); err != nil {
		t.Fatalf("create review state: %v", err)
	}
	if err := application.Store.CreateAttempt(t.Context(), models.Attempt{
		ID: "abandon-self-rating", PromptID: "abandon-recognition", Answer: "",
		OriginalEvaluation: "correct", EffectiveEvaluation: "correct", Feedback: "认识",
		SchedulerRating: 3, PriorCardJSON: json.RawMessage(`{"state":0}`), CreatedAt: now, UpdatedAt: now,
	}); err != nil {
		t.Fatalf("create attempt: %v", err)
	}

	response := requestJSON(t, httpapi.NewRouter(application), http.MethodGet, "/api/knowledge/sense-abandon/mastery", nil)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	var payload models.EnglishMasteryProjection
	decodeJSON(t, response, &payload)
	if payload.KnowledgeItemID != "sense-abandon" || payload.Subject != "english" || len(payload.Dimensions) != 4 {
		t.Fatalf("payload = %#v", payload)
	}
	if payload.Dimensions[0].State != models.MasteryStateSelfReported || payload.Dimensions[0].EvidenceKind != models.MasteryEvidenceSelfReport {
		t.Fatalf("recognition = %#v", payload.Dimensions[0])
	}
	if payload.Dimensions[1].State != models.MasteryStateMissing {
		t.Fatalf("comprehension = %#v", payload.Dimensions[1])
	}
}

func TestKnowledgeMasteryReturnsJSONNotFoundForUnknownKnowledge(t *testing.T) {
	application := testApplication(t, config.Config{})
	response := requestJSON(t, httpapi.NewRouter(application), http.MethodGet, "/api/knowledge/never-filed/mastery", nil)
	if response.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404; body = %s", response.Code, response.Body.String())
	}
	var payload struct {
		Error string `json:"error"`
	}
	decodeJSON(t, response, &payload)
	if payload.Error == "" {
		t.Fatalf("expected JSON error; body = %s", response.Body.String())
	}
}
