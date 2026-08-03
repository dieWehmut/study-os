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

	"study-os/backend/app"
	"study-os/backend/httpapi"
)

func TestLearningLoopFromSeedToReviewAndOverride(t *testing.T) {
	application, err := app.New(context.Background(), app.Options{
		DBPath: filepath.Join(t.TempDir(), "study.db"),
	})
	if err != nil {
		t.Fatalf("construct application: %v", err)
	}
	t.Cleanup(func() { _ = application.Close() })
	router := httpapi.NewRouter(application)

	seedResponse := requestJSON(t, router, http.MethodPost, "/api/demo/seed", nil)
	if seedResponse.Code != http.StatusCreated {
		t.Fatalf("seed status = %d, body = %s", seedResponse.Code, seedResponse.Body.String())
	}

	dueResponse := requestJSON(t, router, http.MethodGet, "/api/reviews/due?limit=10", nil)
	if dueResponse.Code != http.StatusOK {
		t.Fatalf("due status = %d, body = %s", dueResponse.Code, dueResponse.Body.String())
	}
	var dueBody struct {
		Items []struct {
			Prompt struct {
				ID              string   `json:"id"`
				Type            string   `json:"prompt_type"`
				AcceptedAnswers []string `json:"accepted_answers"`
				Options         []string `json:"options"`
			} `json:"prompt"`
			Knowledge struct {
				ItemType          string `json:"item_type"`
				PartOfSpeech      string `json:"part_of_speech"`
				Level             string `json:"level"`
				Term              string `json:"term"`
				ConciseDefinition string `json:"concise_definition"`
				DetailedMarkdown  string `json:"detailed_markdown"`
				Example           string `json:"example"`
			} `json:"knowledge"`
			DueAt string `json:"due_at"`
		} `json:"items"`
	}
	decodeJSON(t, dueResponse, &dueBody)
	if len(dueBody.Items) != 4 || dueBody.Items[0].Knowledge.ItemType != "word_sense" {
		t.Fatalf("due items = %#v", dueBody.Items)
	}
	if len(dueBody.Items[0].Prompt.AcceptedAnswers) != 0 {
		t.Fatalf("due response leaked accepted answers: %#v", dueBody.Items[0].Prompt.AcceptedAnswers)
	}
	if _, err := time.Parse(time.RFC3339Nano, dueBody.Items[0].DueAt); err != nil {
		t.Fatalf("due response omitted top-level due_at: %q (%v)", dueBody.Items[0].DueAt, err)
	}
	for _, item := range dueBody.Items {
		if item.Knowledge.Term != "" || item.Knowledge.ConciseDefinition != "" || item.Knowledge.DetailedMarkdown != "" {
			t.Fatalf("due response leaked answer-bearing knowledge fields: %#v", item.Knowledge)
		}
		if item.Prompt.Type != "context_cloze" && item.Knowledge.Example != "" {
			t.Fatalf("due response leaked example outside cloze prompt: %#v", item.Knowledge)
		}
		if item.Prompt.Type == "context_cloze" {
			if len(item.Prompt.Options) != 4 {
				t.Fatalf("cloze options = %#v, want 4 choices", item.Prompt.Options)
			}
			found := false
			for _, option := range item.Prompt.Options {
				if option == "abandon" {
					found = true
				}
			}
			if !found {
				t.Fatalf("cloze options missing the correct term: %#v", item.Prompt.Options)
			}
		}
	}

	promptID := dueBody.Items[0].Prompt.ID
	answerResponse := requestJSON(t, router, http.MethodPost, "/api/reviews/"+promptID+"/answer", map[string]any{
		"answer":      "坚持",
		"familiarity": 2,
	})
	if answerResponse.Code != http.StatusOK {
		t.Fatalf("answer status = %d, body = %s", answerResponse.Code, answerResponse.Body.String())
	}
	var answerBody struct {
		AttemptID       string   `json:"attempt_id"`
		Outcome         string   `json:"outcome"`
		Rating          int      `json:"rating"`
		DueAt           string   `json:"due_at"`
		ExpectedAnswers []string `json:"expected_answers"`
	}
	decodeJSON(t, answerResponse, &answerBody)
	if answerBody.Outcome != "incorrect" || answerBody.Rating != 1 || answerBody.AttemptID == "" {
		t.Fatalf("answer = %#v", answerBody)
	}
	if len(answerBody.ExpectedAnswers) == 0 {
		t.Fatal("answer response omitted expected answers")
	}
	originalDue, err := time.Parse(time.RFC3339Nano, answerBody.DueAt)
	if err != nil {
		t.Fatalf("parse original due: %v", err)
	}

	overrideResponse := requestJSON(t, router, http.MethodPost, "/api/attempts/"+answerBody.AttemptID+"/override", map[string]any{"rating": 3})
	if overrideResponse.Code != http.StatusOK {
		t.Fatalf("override status = %d, body = %s", overrideResponse.Code, overrideResponse.Body.String())
	}
	var overrideBody struct {
		Outcome         string   `json:"outcome"`
		Rating          int      `json:"rating"`
		DueAt           string   `json:"due_at"`
		ExpectedAnswers []string `json:"expected_answers"`
	}
	decodeJSON(t, overrideResponse, &overrideBody)
	if overrideBody.Rating != 3 || overrideBody.Outcome != "correct" {
		t.Fatalf("override = %#v", overrideBody)
	}
	if len(overrideBody.ExpectedAnswers) == 0 {
		t.Fatal("override response omitted expected answers")
	}
	overriddenDue, err := time.Parse(time.RFC3339Nano, overrideBody.DueAt)
	if err != nil {
		t.Fatalf("parse override due: %v", err)
	}
	if !overriddenDue.After(originalDue) {
		t.Fatalf("override due %s is not after original %s", overriddenDue, originalDue)
	}

	dashboardResponse := requestJSON(t, router, http.MethodGet, "/api/dashboard", nil)
	if dashboardResponse.Code != http.StatusOK {
		t.Fatalf("dashboard status = %d, body = %s", dashboardResponse.Code, dashboardResponse.Body.String())
	}
	var dashboard struct {
		KnowledgeCount int    `json:"knowledge_count"`
		PromptCount    int    `json:"prompt_count"`
		AttemptCount   int    `json:"attempt_count"`
		DueCount       int    `json:"due_count"`
		ReviewedToday  int    `json:"reviewed_today"`
		CurrentStreak  int    `json:"current_streak"`
		Provider       string `json:"provider"`
		Offline        bool   `json:"offline"`
	}
	decodeJSON(t, dashboardResponse, &dashboard)
	if dashboard.KnowledgeCount != 1 || dashboard.PromptCount != 4 || dashboard.AttemptCount != 1 {
		t.Fatalf("dashboard = %#v", dashboard)
	}
	if dashboard.ReviewedToday != 1 || dashboard.CurrentStreak != 1 || dashboard.Provider != "mock" || !dashboard.Offline {
		t.Fatalf("dashboard status fields = %#v", dashboard)
	}
}

func TestAnswerRejectsFamiliarityOutsideOneToFive(t *testing.T) {
	application, err := app.New(context.Background(), app.Options{
		DBPath: filepath.Join(t.TempDir(), "study.db"),
	})
	if err != nil {
		t.Fatalf("construct application: %v", err)
	}
	t.Cleanup(func() { _ = application.Close() })
	router := httpapi.NewRouter(application)
	requestJSON(t, router, http.MethodPost, "/api/demo/seed", nil)

	dueResponse := requestJSON(t, router, http.MethodGet, "/api/reviews/due?limit=1", nil)
	var dueBody struct {
		Items []struct {
			Prompt struct {
				ID string `json:"id"`
			} `json:"prompt"`
		} `json:"items"`
	}
	decodeJSON(t, dueResponse, &dueBody)
	if len(dueBody.Items) != 1 {
		t.Fatalf("due items = %#v", dueBody.Items)
	}

	response := requestJSON(t, router, http.MethodPost, "/api/reviews/"+dueBody.Items[0].Prompt.ID+"/answer", map[string]any{
		"answer": "abandon", "familiarity": 6,
	})
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	var attempts int
	if err := application.Store.SQL().QueryRow(`SELECT COUNT(*) FROM attempts`).Scan(&attempts); err != nil {
		t.Fatalf("count attempts: %v", err)
	}
	if attempts != 0 {
		t.Fatalf("invalid familiarity created %d attempts", attempts)
	}
}

func requestJSON(t *testing.T, handler http.Handler, method, target string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var payload bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&payload).Encode(body); err != nil {
			t.Fatalf("encode request: %v", err)
		}
	}
	request := httptest.NewRequest(method, "http://127.0.0.1"+target, &payload)
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func decodeJSON(t *testing.T, response *httptest.ResponseRecorder, target any) {
	t.Helper()
	if err := json.NewDecoder(response.Body).Decode(target); err != nil {
		t.Fatalf("decode response: %v; body = %s", err, response.Body.String())
	}
}
