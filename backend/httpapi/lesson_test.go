package httpapi_test

import (
	"context"
	"net/http"
	"path/filepath"
	"testing"

	"study-os/backend/app"
	"study-os/backend/httpapi"
	"study-os/backend/models"
)

func TestLessonRoutesCreateUpdateHistoryAndConflict(t *testing.T) {
	application, err := app.New(context.Background(), app.Options{DBPath: filepath.Join(t.TempDir(), "study.db")})
	if err != nil {
		t.Fatalf("construct application: %v", err)
	}
	t.Cleanup(func() { _ = application.Close() })
	router := httpapi.NewRouter(application)

	createdResponse := requestJSON(t, router, http.MethodPost, "/api/lessons", map[string]any{
		"id": "lesson-http", "subject": "physics", "title": "力学导论",
		"source_type": "source", "source_id": "source-1",
		"document": map[string]any{"sections": []any{map[string]any{
			"type": "objectives", "content": map[string]any{"items": []string{"理解力"}},
		}}},
	})
	if createdResponse.Code != http.StatusCreated {
		t.Fatalf("create status = %d; body = %s", createdResponse.Code, createdResponse.Body.String())
	}
	var created models.Lesson
	decodeJSON(t, createdResponse, &created)
	if created.ID != "lesson-http" || created.CurrentVersion != 1 || len(created.Document.Sections) != 10 {
		t.Fatalf("created = %#v", created)
	}

	missingVersion := requestJSON(t, router, http.MethodPatch, "/api/lessons/lesson-http", map[string]any{
		"title": "Unversioned overwrite",
	})
	if missingVersion.Code != http.StatusBadRequest {
		t.Fatalf("missing version status = %d; body = %s", missingVersion.Code, missingVersion.Body.String())
	}

	updatedResponse := requestJSON(t, router, http.MethodPatch, "/api/lessons/lesson-http", map[string]any{
		"title": "力学导论（修订）", "status": "reviewed", "version": 1,
		"document": map[string]any{"sections": []any{map[string]any{
			"type": "summary", "content": map[string]any{"text": "总结"},
		}}},
	})
	if updatedResponse.Code != http.StatusOK {
		t.Fatalf("update status = %d; body = %s", updatedResponse.Code, updatedResponse.Body.String())
	}
	var updated models.Lesson
	decodeJSON(t, updatedResponse, &updated)
	if updated.CurrentVersion != 2 || updated.Title != "力学导论（修订）" || updated.Status != models.LessonStatusReviewed {
		t.Fatalf("updated = %#v", updated)
	}

	conflict := requestJSON(t, router, http.MethodPatch, "/api/lessons/lesson-http", map[string]any{
		"title": "过期写入", "version": 1,
	})
	if conflict.Code != http.StatusConflict {
		t.Fatalf("conflict status = %d; body = %s", conflict.Code, conflict.Body.String())
	}

	history := requestJSON(t, router, http.MethodGet, "/api/lessons/lesson-http?version=1", nil)
	if history.Code != http.StatusOK {
		t.Fatalf("history status = %d; body = %s", history.Code, history.Body.String())
	}
	var historical models.Lesson
	decodeJSON(t, history, &historical)
	if historical.CurrentVersion != 1 || historical.Title != updated.Title {
		t.Fatalf("historical = %#v", historical)
	}
	if historical.Document.Sections[1].Content == nil || string(historical.Document.Sections[1].Content) == `{"text":"总结"}` {
		t.Fatalf("historical document unexpectedly current: %#v", historical.Document.Sections[1])
	}

	if historical.Status != updated.Status || string(historical.Document.Sections[7].Content) != `{}` {
		t.Fatalf("historical response must combine current metadata with version 1 document: %#v", historical)
	}

	missingHistory := requestJSON(t, router, http.MethodGet, "/api/lessons/lesson-http?version=99", nil)
	if missingHistory.Code != http.StatusNotFound {
		t.Fatalf("missing history status = %d; body = %s", missingHistory.Code, missingHistory.Body.String())
	}

	list := requestJSON(t, router, http.MethodGet, "/api/lessons?subject=physics&status=reviewed", nil)
	if list.Code != http.StatusOK {
		t.Fatalf("list status = %d; body = %s", list.Code, list.Body.String())
	}
	var listed struct {
		Items []models.LessonSummary `json:"items"`
		Count int                    `json:"count"`
	}
	decodeJSON(t, list, &listed)
	if listed.Count != 1 || len(listed.Items) != 1 || listed.Items[0].CurrentVersion != 2 {
		t.Fatalf("listed = %#v", listed)
	}

	invalid := requestJSON(t, router, http.MethodPost, "/api/lessons", map[string]any{"title": "bad", "status": "unknown"})
	if invalid.Code != http.StatusBadRequest {
		t.Fatalf("invalid status = %d; body = %s", invalid.Code, invalid.Body.String())
	}

	duplicate := requestJSON(t, router, http.MethodPost, "/api/lessons", map[string]any{
		"id": "lesson-http", "title": "Duplicate",
	})
	if duplicate.Code != http.StatusConflict {
		t.Fatalf("duplicate status = %d; body = %s", duplicate.Code, duplicate.Body.String())
	}
}

func TestLessonRoutesReturnNotFoundAndRejectBadHistoryVersion(t *testing.T) {
	application, err := app.New(context.Background(), app.Options{DBPath: filepath.Join(t.TempDir(), "study.db")})
	if err != nil {
		t.Fatalf("construct application: %v", err)
	}
	t.Cleanup(func() { _ = application.Close() })
	router := httpapi.NewRouter(application)

	missing := requestJSON(t, router, http.MethodGet, "/api/lessons/missing", nil)
	if missing.Code != http.StatusNotFound {
		t.Fatalf("missing status = %d; body = %s", missing.Code, missing.Body.String())
	}
	badVersion := requestJSON(t, router, http.MethodGet, "/api/lessons/missing?version=nope", nil)
	if badVersion.Code != http.StatusBadRequest {
		t.Fatalf("bad version status = %d; body = %s", badVersion.Code, badVersion.Body.String())
	}
}
