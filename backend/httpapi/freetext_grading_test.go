package httpapi_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"study-os/backend/config"
	"study-os/backend/httpapi"
	"study-os/backend/models"
)

// seedSentencePrompt builds the one prompt shape that reaches the vendor while
// the learner waits: a sentence-building prompt has no accepted answers, so
// handleAnswer cannot grade it locally and calls out to the AI instead.
func seedSentencePrompt(t *testing.T, vendorURL string) (http.Handler, string) {
	t.Helper()
	application := testApplication(t, config.Config{
		ActiveProvider: "deepseek",
		AI: map[string]config.VendorConfig{
			"deepseek": {APIKey: "sk-test", BaseURL: vendorURL, Model: "deepseek-chat"},
		},
	})
	ctx := context.Background()
	now := time.Date(2026, 8, 8, 12, 0, 0, 0, time.UTC)
	if err := application.Store.CreateKnowledgeItem(ctx, models.KnowledgeItem{
		ID: "k-sentence", ItemType: "word_sense", Term: "abandon", ConciseDefinition: "放弃",
		Subject: "english", CreatedAt: now, UpdatedAt: now,
	}); err != nil {
		t.Fatalf("create knowledge item: %v", err)
	}
	prompt := models.Prompt{
		ID: "p-sentence", KnowledgeItemID: "k-sentence", PromptType: "make_sentence",
		Question: "用 abandon 造一个句子", CreatedAt: now, UpdatedAt: now,
	}
	if err := application.Store.CreatePrompt(ctx, prompt); err != nil {
		t.Fatalf("create prompt: %v", err)
	}
	if err := application.Store.UpsertReviewState(ctx, models.ReviewState{
		PromptID: prompt.ID, CardJSON: json.RawMessage(`{"Due":"2026-08-08T00:00:00Z"}`),
		DueAt: now, UpdatedAt: now,
	}); err != nil {
		t.Fatalf("upsert review state: %v", err)
	}
	return httpapi.NewRouter(application), prompt.ID
}

func TestFreeTextGradingFallsBackOfflineWhenTheVendorIsDown(t *testing.T) {
	// The README promises sentence prompts degrade to partial credit offline.
	// That only happens if a dead vendor produces an error rather than an HTTP
	// 500, so pin it at the route rather than trusting the helper in isolation.
	dead := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	deadURL := dead.URL
	dead.Close() // nothing is listening now, so the dial fails immediately

	router, promptID := seedSentencePrompt(t, deadURL)
	response := requestJSON(t, router, http.MethodPost, "/api/reviews/"+promptID+"/answer", map[string]any{
		"answer": "I abandon the old plan.",
	})

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	var body struct {
		Outcome string `json:"outcome"`
		Rating  int    `json:"rating"`
	}
	decodeJSON(t, response, &body)
	if body.Outcome != "partial" {
		t.Fatalf("outcome = %q, want the offline partial grade", body.Outcome)
	}
}

func TestFreeTextGradingKeepsTheScheduleConsistentWithTheOutcome(t *testing.T) {
	// Vendors omit fields. A grading reply of {"outcome":"correct","message":..}
	// with no rating decodes to Rating 0, which toFSRSRating maps to Again --
	// so the learner is told they were right while the card is scheduled as a
	// failure. Nothing surfaces the contradiction; the interval just collapses.
	vendor := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"choices":[{"message":{"content":"{\"outcome\":\"correct\",\"message\":\"句子通顺，用法准确。\"}"}}]}`))
	}))
	t.Cleanup(vendor.Close)

	router, promptID := seedSentencePrompt(t, vendor.URL)
	response := requestJSON(t, router, http.MethodPost, "/api/reviews/"+promptID+"/answer", map[string]any{
		"answer": "I abandon the old plan.",
	})

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	var body struct {
		Outcome string `json:"outcome"`
		Rating  int    `json:"rating"`
	}
	decodeJSON(t, response, &body)
	if body.Outcome != "correct" {
		t.Fatalf("outcome = %q, want the vendor's verdict", body.Outcome)
	}
	if body.Rating != 3 {
		t.Fatalf("rating = %d for a correct answer, want 3; a 1 here schedules it as a failure", body.Rating)
	}
}
