package httpapi_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	fsrs "github.com/open-spaced-repetition/go-fsrs/v3"

	"study-os/backend/app"
	"study-os/backend/httpapi"
	"study-os/backend/models"
)

func newSelfRatingApp(t *testing.T) *app.App {
	t.Helper()
	application, err := app.New(context.Background(), app.Options{
		DBPath: filepath.Join(t.TempDir(), "study.db"),
	})
	if err != nil {
		t.Fatalf("construct application: %v", err)
	}
	t.Cleanup(func() { _ = application.Close() })

	ctx := context.Background()
	now := time.Now().UTC()

	if err := application.Store.CreateKnowledgeItem(ctx, models.KnowledgeItem{
		ID:                "sr-item",
		ItemType:          "word_sense",
		Subject:           "english",
		Term:              "abandon",
		ConciseDefinition: "放弃",
		CreatedAt:         now,
		UpdatedAt:         now,
	}); err != nil {
		t.Fatalf("create knowledge item: %v", err)
	}

	if err := application.Store.CreatePrompt(ctx, models.Prompt{
		ID:              "sr-prompt",
		KnowledgeItemID: "sr-item",
		PromptType:      "en_to_zh",
		Question:        "abandon",
		AcceptedAnswers: []string{"放弃"},
		CreatedAt:       now,
		UpdatedAt:       now,
	}); err != nil {
		t.Fatalf("create prompt: %v", err)
	}

	card := fsrs.NewCard()
	card.Due = now.Add(-time.Hour)
	cardJSON, err := json.Marshal(card)
	if err != nil {
		t.Fatalf("marshal card: %v", err)
	}
	if err := application.Store.UpsertReviewState(ctx, models.ReviewState{
		PromptID:  "sr-prompt",
		CardJSON:  cardJSON,
		DueAt:     card.Due,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("upsert review state: %v", err)
	}

	return application
}

func postSelfRating(t *testing.T, application *app.App, body string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(
		http.MethodPost,
		"http://127.0.0.1/api/reviews/sr-prompt/answer",
		bytes.NewReader([]byte(body)),
	)
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	httpapi.NewRouter(application).ServeHTTP(response, request)
	return response
}

func TestAnswerAcceptsSelfRating(t *testing.T) {
	application := newSelfRatingApp(t)

	response := postSelfRating(t, application, `{"self_rating":3}`)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusOK, response.Body.String())
	}

	var body struct {
		Outcome         string   `json:"outcome"`
		Rating          int      `json:"rating"`
		Feedback        string   `json:"feedback"`
		ExpectedAnswers []string `json:"expected_answers"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode answer response: %v", err)
	}
	if body.Outcome != "correct" {
		t.Errorf("outcome = %q, want %q", body.Outcome, "correct")
	}
	if body.Rating != 3 {
		t.Errorf("rating = %d, want 3", body.Rating)
	}
	if body.Feedback != "认识" {
		t.Errorf("feedback = %q, want %q", body.Feedback, "认识")
	}
	if len(body.ExpectedAnswers) != 1 || body.ExpectedAnswers[0] != "放弃" {
		t.Errorf("expected_answers = %v, want [放弃]", body.ExpectedAnswers)
	}
}

func TestAnswerSelfRatingAgainMapsToRatingOne(t *testing.T) {
	application := newSelfRatingApp(t)

	response := postSelfRating(t, application, `{"self_rating":1}`)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusOK, response.Body.String())
	}

	var body struct {
		Outcome string `json:"outcome"`
		Rating  int    `json:"rating"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode answer response: %v", err)
	}
	if body.Outcome != "incorrect" {
		t.Errorf("outcome = %q, want %q", body.Outcome, "incorrect")
	}
	if body.Rating != 1 {
		t.Errorf("rating = %d, want 1", body.Rating)
	}
}

func TestAnswerRejectsOutOfRangeSelfRating(t *testing.T) {
	application := newSelfRatingApp(t)

	for _, body := range []string{`{"self_rating":0}`, `{"self_rating":4}`} {
		response := postSelfRating(t, application, body)
		if response.Code != http.StatusBadRequest {
			t.Errorf("body %s: status = %d, want %d", body, response.Code, http.StatusBadRequest)
		}
	}
}
