package httpapi_test

import (
	"net/http"
	"testing"

	"study-os/backend/config"
	"study-os/backend/httpapi"
)

// Documents are immutable, so the version table is the only way back to what a
// lesson said before it was edited. The API promised 回滚 when that table was
// added; until now nothing could read it.
func TestLessonVersionHistoryListsEveryRevision(t *testing.T) {
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)

	created := requestJSON(t, router, http.MethodPost, "/api/lessons", map[string]any{
		"subject": "physics", "title": "第一版标题",
	})
	if created.Code != http.StatusCreated {
		t.Fatalf("create = %d, body = %s", created.Code, created.Body.String())
	}
	var lesson struct {
		ID      string `json:"id"`
		Version int    `json:"version"`
	}
	decodeJSON(t, created, &lesson)

	for _, title := range []string{"第二版标题", "第三版标题"} {
		patched := requestJSON(t, router, http.MethodPatch, "/api/lessons/"+lesson.ID, map[string]any{
			"version": lesson.Version,
			"title":   title,
			"document": map[string]any{
				"schema_version": 1,
				"sections": []map[string]any{
					{"id": "concept", "type": "concept", "title": "核心概念", "position": 2, "required": true,
						"content": map[string]any{"items": []string{title}}},
				},
			},
		})
		if patched.Code != http.StatusOK {
			t.Fatalf("patch %q = %d, body = %s", title, patched.Code, patched.Body.String())
		}
		decodeJSON(t, patched, &lesson)
	}

	var history struct {
		Count int `json:"count"`
		Items []struct {
			Version        int    `json:"version"`
			CreatedAt      string `json:"created_at"`
			SectionsFilled int    `json:"sections_filled"`
		} `json:"items"`
	}
	list := requestJSON(t, router, http.MethodGet, "/api/lessons/"+lesson.ID+"/versions", nil)
	if list.Code != http.StatusOK {
		t.Fatalf("versions = %d, body = %s", list.Code, list.Body.String())
	}
	decodeJSON(t, list, &history)
	if history.Count != 3 || len(history.Items) != 3 {
		t.Fatalf("history = %#v, want every revision (3)", history)
	}
	// Newest first, so the first row is what the lesson says now.
	if history.Items[0].Version != 3 || history.Items[2].Version != 1 {
		t.Fatalf("versions = %v, want 3,2,1", []int{history.Items[0].Version, history.Items[1].Version, history.Items[2].Version})
	}
	if history.Items[0].CreatedAt == "" {
		t.Fatalf("newest revision has no time: %#v", history.Items[0])
	}
	// The first revision is the empty template; the later two each carry 核心概念.
	if history.Items[2].SectionsFilled != 0 {
		t.Fatalf("first revision filled = %d, want 0", history.Items[2].SectionsFilled)
	}
	if history.Items[0].SectionsFilled != 1 {
		t.Fatalf("newest revision filled = %d, want 1", history.Items[0].SectionsFilled)
	}

	// A lesson that does not exist is a 404, not an empty history.
	missing := requestJSON(t, router, http.MethodGet, "/api/lessons/nope/versions", nil)
	if missing.Code != http.StatusNotFound {
		t.Fatalf("missing lesson = %d, want 404; body = %s", missing.Code, missing.Body.String())
	}
}
