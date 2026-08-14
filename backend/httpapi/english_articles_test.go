package httpapi_test

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"study-os/backend/agent"
	"study-os/backend/config"
	"study-os/backend/httpapi"
)

type englishArticleHTTPResponse struct {
	ID            string                      `json:"id"`
	Title         string                      `json:"title"`
	OriginalTitle string                      `json:"original_title"`
	Author        string                      `json:"author"`
	SourceName    string                      `json:"source_name"`
	SourceURL     string                      `json:"source_url"`
	PublishedAt   string                      `json:"published_at"`
	OriginalText  string                      `json:"original_text"`
	Content       agent.EnglishArticleContent `json:"content"`
	Markdown      string                      `json:"markdown"`
	Provider      string                      `json:"provider"`
	Model         string                      `json:"model"`
	SectionCount  int                         `json:"section_count"`
}

func TestEnglishArticleGenerateCreateListGetDeleteLifecycle(t *testing.T) {
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)
	originalText := "Learning slowly builds durable skill. Practice turns knowledge into ability."

	generatedResponse := requestJSON(t, router, http.MethodPost, "/api/english/articles/generate", map[string]any{
		"original_text":  originalText,
		"title":          "学习如何发生",
		"original_title": "How Learning Works",
		"author":         "A. Writer",
		"source_name":    "Daily Brief",
		"source_url":     "https://example.test/learning",
		"published_at":   "2026-08-15",
	})
	if generatedResponse.Code != http.StatusOK {
		t.Fatalf("generate = %d, body = %s", generatedResponse.Code, generatedResponse.Body.String())
	}
	var generated englishArticleHTTPResponse
	decodeJSON(t, generatedResponse, &generated)
	if generated.Title != "学习如何发生" || generated.OriginalText != originalText || generated.Provider != "mock" {
		t.Fatalf("generated = %#v", generated)
	}
	if len(generated.Content.Sections) < 2 || !strings.Contains(generated.Markdown, "<u>") {
		t.Fatalf("generated content = %#v; markdown = %s", generated.Content, generated.Markdown)
	}

	createdResponse := requestJSON(t, router, http.MethodPost, "/api/english/articles", map[string]any{
		"title":          generated.Title,
		"original_title": generated.OriginalTitle,
		"author":         generated.Author,
		"source_name":    generated.SourceName,
		"source_url":     generated.SourceURL,
		"published_at":   generated.PublishedAt,
		"original_text":  generated.OriginalText,
		"content":        generated.Content,
		"markdown":       "client supplied markdown must be ignored",
		"provider":       generated.Provider,
		"model":          generated.Model,
	})
	if createdResponse.Code != http.StatusCreated {
		t.Fatalf("create = %d, body = %s", createdResponse.Code, createdResponse.Body.String())
	}
	var created englishArticleHTTPResponse
	decodeJSON(t, createdResponse, &created)
	if created.ID == "" || created.OriginalText != originalText {
		t.Fatalf("created = %#v", created)
	}
	if strings.Contains(created.Markdown, "client supplied") || !strings.Contains(created.Markdown, "<u>") {
		t.Fatalf("server did not regenerate canonical markdown: %s", created.Markdown)
	}

	listedResponse := requestJSON(t, router, http.MethodGet, "/api/english/articles?limit=10", nil)
	if listedResponse.Code != http.StatusOK {
		t.Fatalf("list = %d, body = %s", listedResponse.Code, listedResponse.Body.String())
	}
	var listed struct {
		Items []englishArticleHTTPResponse `json:"items"`
		Count int                          `json:"count"`
	}
	decodeJSON(t, listedResponse, &listed)
	if listed.Count != 1 || len(listed.Items) != 1 || listed.Items[0].ID != created.ID || listed.Items[0].SectionCount != 2 {
		t.Fatalf("listed = %#v", listed)
	}

	gotResponse := requestJSON(t, router, http.MethodGet, "/api/english/articles/"+created.ID, nil)
	if gotResponse.Code != http.StatusOK {
		t.Fatalf("get = %d, body = %s", gotResponse.Code, gotResponse.Body.String())
	}
	var got englishArticleHTTPResponse
	decodeJSON(t, gotResponse, &got)
	if got.ID != created.ID || len(got.Content.Sections) != 2 || got.Markdown != created.Markdown {
		t.Fatalf("got = %#v", got)
	}
	regeneratedResponse := requestJSON(t, router, http.MethodPost, "/api/english/articles/"+created.ID+"/regenerate", nil)
	if regeneratedResponse.Code != http.StatusOK {
		t.Fatalf("regenerate = %d, body = %s", regeneratedResponse.Code, regeneratedResponse.Body.String())
	}
	var regenerated englishArticleHTTPResponse
	decodeJSON(t, regeneratedResponse, &regenerated)
	if regenerated.ID != created.ID || regenerated.OriginalText != originalText || len(regenerated.Content.Sections) != 2 {
		t.Fatalf("regenerated = %#v", regenerated)
	}

	deletedResponse := requestJSON(t, router, http.MethodDelete, "/api/english/articles/"+created.ID, nil)
	if deletedResponse.Code != http.StatusNoContent {
		t.Fatalf("delete = %d, body = %s", deletedResponse.Code, deletedResponse.Body.String())
	}
	missingResponse := requestJSON(t, router, http.MethodGet, "/api/english/articles/"+created.ID, nil)
	if missingResponse.Code != http.StatusNotFound || !strings.Contains(missingResponse.Body.String(), `"error"`) {
		t.Fatalf("get deleted = %d, body = %s", missingResponse.Code, missingResponse.Body.String())
	}
}

func TestEnglishArticleGenerateRejectsInvalidInputAndUnavailableProvider(t *testing.T) {
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)

	empty := requestJSON(t, router, http.MethodPost, "/api/english/articles/generate", map[string]any{"original_text": "  "})
	if empty.Code != http.StatusBadRequest || !strings.Contains(empty.Body.String(), `"error"`) {
		t.Fatalf("empty input = %d, body = %s", empty.Code, empty.Body.String())
	}

	application.Config.ActiveProvider = "deepseek"
	application.Config.AI = map[string]config.VendorConfig{"deepseek": {}}
	unavailable := requestJSON(t, router, http.MethodPost, "/api/english/articles/generate", map[string]any{
		"original_text": "A valid article.",
	})
	if unavailable.Code != http.StatusServiceUnavailable || !strings.Contains(unavailable.Body.String(), `"error"`) {
		t.Fatalf("unavailable provider = %d, body = %s", unavailable.Code, unavailable.Body.String())
	}
}

func TestEnglishArticleCreateRejectsIncompleteContent(t *testing.T) {
	application := testApplication(t, config.Config{})
	response := requestJSON(t, httpapi.NewRouter(application), http.MethodPost, "/api/english/articles", map[string]any{
		"original_text": "A valid source paragraph.",
		"content": map[string]any{
			"title":    "Incomplete",
			"metadata": map[string]any{},
			"sections": []any{},
		},
	})
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), `"error"`) {
		t.Fatalf("incomplete create = %d, body = %s", response.Code, response.Body.String())
	}
}

func TestEnglishArticleCreateRejectsUnknownContentFields(t *testing.T) {
	application := testApplication(t, config.Config{})
	response := requestJSON(t, httpapi.NewRouter(application), http.MethodPost, "/api/english/articles", map[string]any{
		"original_text": "A valid source paragraph.",
		"content": map[string]any{
			"title":    "Strict article",
			"metadata": map[string]any{},
			"sections": []any{map[string]any{
				"title":      "Section",
				"unexpected": true,
				"paragraphs": []any{map[string]any{
					"segments":    []any{map[string]any{"text": "A valid source paragraph."}},
					"translation": "有效的原文段落。",
				}},
			}},
		},
	})
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), `"error"`) {
		t.Fatalf("unknown content field = %d, body = %s", response.Code, response.Body.String())
	}
}

func TestEnglishArticleMissingResourcesReturnJSON404(t *testing.T) {
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)
	for _, testCase := range []struct{ method, path string }{
		{http.MethodGet, "/api/english/articles/missing"},
		{http.MethodPost, "/api/english/articles/missing/regenerate"},
		{http.MethodDelete, "/api/english/articles/missing"},
	} {
		response := requestJSON(t, router, testCase.method, testCase.path, nil)
		if response.Code != http.StatusNotFound || !strings.Contains(response.Body.String(), `"error"`) {
			t.Errorf("%s %s = %d, body = %s", testCase.method, testCase.path, response.Code, response.Body.String())
		}
	}
}

func TestEnglishArticleFailedRegenerationPreservesStoredContent(t *testing.T) {
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)
	generatedResponse := requestJSON(t, router, http.MethodPost, "/api/english/articles/generate", map[string]any{
		"original_text": "Old content stays intact. Regeneration may fail.",
		"title":         "Stable article",
	})
	var generated englishArticleHTTPResponse
	decodeJSON(t, generatedResponse, &generated)
	createdResponse := requestJSON(t, router, http.MethodPost, "/api/english/articles", map[string]any{
		"title": generated.Title, "original_text": generated.OriginalText,
		"content": generated.Content, "provider": generated.Provider, "model": generated.Model,
	})
	var created englishArticleHTTPResponse
	decodeJSON(t, createdResponse, &created)
	before, err := application.Store.GetEnglishArticle(t.Context(), created.ID)
	if err != nil {
		t.Fatalf("read before regeneration: %v", err)
	}

	application.Config.ActiveProvider = "deepseek"
	application.Config.AI = map[string]config.VendorConfig{"deepseek": {}}
	failed := requestJSON(t, router, http.MethodPost, "/api/english/articles/"+created.ID+"/regenerate", nil)
	if failed.Code != http.StatusServiceUnavailable {
		t.Fatalf("failed regenerate = %d, body = %s", failed.Code, failed.Body.String())
	}
	after, err := application.Store.GetEnglishArticle(t.Context(), created.ID)
	if err != nil {
		t.Fatalf("read after regeneration: %v", err)
	}
	if string(after.ContentJSON) != string(before.ContentJSON) || after.Markdown != before.Markdown || !after.UpdatedAt.Equal(before.UpdatedAt) {
		beforeJSON, _ := json.Marshal(before)
		afterJSON, _ := json.Marshal(after)
		t.Fatalf("failed regeneration changed article:\nbefore=%s\nafter=%s", beforeJSON, afterJSON)
	}
}
