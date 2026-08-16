package httpapi_test

import (
	"net/http"
	"strings"
	"testing"

	"study-os/backend/config"
	"study-os/backend/httpapi"
	"study-os/backend/models"
)

func TestVocabularyLookupGeneratesAndThenUsesSavedItem(t *testing.T) {
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)
	body := map[string]any{"term": "complicated", "context": "Tell me about a complicated man.", "kind": "word"}
	generated := requestJSON(t, router, http.MethodPost, "/api/knowledge/lookup", body)
	if generated.Code != http.StatusCreated {
		t.Fatalf("generated status=%d body=%s", generated.Code, generated.Body.String())
	}
	if !strings.Contains(generated.Body.String(), `"source":"generated"`) {
		t.Fatalf("generated body=%s", generated.Body.String())
	}
	second := requestJSON(t, router, http.MethodPost, "/api/knowledge/lookup", body)
	if second.Code != http.StatusOK || !strings.Contains(second.Body.String(), `"source":"existing"`) {
		t.Fatalf("existing status=%d body=%s", second.Code, second.Body.String())
	}
}

func TestVocabularyLookupAcceptsExistingItemWithoutProvider(t *testing.T) {
	application := testApplication(t, config.Config{ActiveProvider: "not-configured"})
	if err := application.Store.CreateKnowledgeItem(t.Context(), models.KnowledgeItem{
		ID: "local-vocab", ItemType: "word_wiki", Term: "abandon", Subject: "english", ConciseDefinition: "leave",
	}); err != nil {
		t.Fatalf("create local item: %v", err)
	}
	response := requestJSON(t, httpapi.NewRouter(application), http.MethodPost, "/api/knowledge/lookup", map[string]any{
		"term": "abandon", "context": "They abandon the plan.", "kind": "word",
	})
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"source":"existing"`) {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestVocabularyLookupRejectsMalformedRequests(t *testing.T) {
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)
	cases := []map[string]any{
		{"term": "", "context": "context", "kind": "word"},
		{"term": "word", "context": "", "kind": "word"},
		{"term": "word", "context": "context", "kind": "unknown"},
		{"term": "word", "context": "context", "kind": "word", "extra": true},
	}
	for _, body := range cases {
		response := requestJSON(t, router, http.MethodPost, "/api/knowledge/lookup", body)
		if response.Code != http.StatusBadRequest {
			t.Errorf("body=%v status=%d want 400: %s", body, response.Code, response.Body.String())
		}
	}
}

func TestVocabularyLookupReturnsServiceUnavailableWithoutProvider(t *testing.T) {
	application := testApplication(t, config.Config{ActiveProvider: "not-configured"})
	response := requestJSON(t, httpapi.NewRouter(application), http.MethodPost, "/api/knowledge/lookup", map[string]any{
		"term": "missing", "context": "a missing word", "kind": "word",
	})
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}
