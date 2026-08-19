package httpapi_test

import (
	"net/http"
	"testing"

	"study-os/backend/config"
	"study-os/backend/httpapi"
	"study-os/backend/models"
)

func TestLessonLinkRoutesCreateListReverseAndDelete(t *testing.T) {
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)
	if err := application.Store.CreateLesson(t.Context(), models.Lesson{
		ID: "lesson-link-http", Title: "关联 API", Document: models.NewLessonDocument(),
	}); err != nil {
		t.Fatalf("create lesson: %v", err)
	}
	if err := application.Store.CreateKnowledgeItem(t.Context(), models.KnowledgeItem{
		ID: "knowledge-link-http", ItemType: "concept", Term: "功", ConciseDefinition: "力做功",
	}); err != nil {
		t.Fatalf("create knowledge item: %v", err)
	}
	if err := application.Store.CreatePrompt(t.Context(), models.Prompt{
		ID: "prompt-link-http", KnowledgeItemID: "knowledge-link-http", PromptType: "en_to_zh", Question: "功是什么？",
	}); err != nil {
		t.Fatalf("create prompt: %v", err)
	}

	created := requestJSON(t, router, http.MethodPost, "/api/lessons/lesson-link-http/links", map[string]any{
		"target_type": models.LessonLinkTargetKnowledgeItem, "target_id": "knowledge-link-http",
	})
	if created.Code != http.StatusCreated {
		t.Fatalf("create link status = %d; body = %s", created.Code, created.Body.String())
	}
	var link models.LessonLink
	decodeJSON(t, created, &link)
	if link.LessonID != "lesson-link-http" || link.TargetID != "knowledge-link-http" {
		t.Fatalf("created link = %#v", link)
	}

	promptCreated := requestJSON(t, router, http.MethodPost, "/api/lessons/lesson-link-http/links", map[string]any{
		"target_type": models.LessonLinkTargetPrompt, "target_id": "prompt-link-http",
	})
	if promptCreated.Code != http.StatusCreated {
		t.Fatalf("create prompt link status = %d; body = %s", promptCreated.Code, promptCreated.Body.String())
	}

	duplicate := requestJSON(t, router, http.MethodPost, "/api/lessons/lesson-link-http/links", map[string]any{
		"target_type": models.LessonLinkTargetKnowledgeItem, "target_id": "knowledge-link-http",
	})
	if duplicate.Code != http.StatusConflict {
		t.Fatalf("duplicate status = %d; body = %s", duplicate.Code, duplicate.Body.String())
	}

	list := requestJSON(t, router, http.MethodGet, "/api/lessons/lesson-link-http/links?target_type=prompt", nil)
	if list.Code != http.StatusOK {
		t.Fatalf("list status = %d; body = %s", list.Code, list.Body.String())
	}
	var listed struct {
		Items []models.LessonLink `json:"items"`
		Count int                 `json:"count"`
	}
	decodeJSON(t, list, &listed)
	if listed.Count != 1 || len(listed.Items) != 1 || listed.Items[0].TargetID != "prompt-link-http" {
		t.Fatalf("listed = %#v", listed)
	}

	reverse := requestJSON(t, router, http.MethodGet,
		"/api/lesson-links?target_type=knowledge_item&target_id=knowledge-link-http", nil)
	if reverse.Code != http.StatusOK {
		t.Fatalf("reverse status = %d; body = %s", reverse.Code, reverse.Body.String())
	}
	decodeJSON(t, reverse, &listed)
	if listed.Count != 1 || len(listed.Items) != 1 || listed.Items[0].LessonID != "lesson-link-http" {
		t.Fatalf("reverse = %#v", listed)
	}

	deleted := requestJSON(t, router, http.MethodDelete,
		"/api/lessons/lesson-link-http/links/prompt/prompt-link-http", nil)
	if deleted.Code != http.StatusNoContent {
		t.Fatalf("delete status = %d; body = %s", deleted.Code, deleted.Body.String())
	}
	missingDelete := requestJSON(t, router, http.MethodDelete,
		"/api/lessons/lesson-link-http/links/prompt/prompt-link-http", nil)
	if missingDelete.Code != http.StatusNotFound {
		t.Fatalf("missing delete status = %d; body = %s", missingDelete.Code, missingDelete.Body.String())
	}
}

func TestLessonLinkRoutesRejectInvalidAndMissingTargets(t *testing.T) {
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)
	badType := requestJSON(t, router, http.MethodPost, "/api/lessons/missing/links", map[string]any{
		"target_type": "question", "target_id": "q",
	})
	if badType.Code != http.StatusBadRequest {
		t.Fatalf("bad type status = %d; body = %s", badType.Code, badType.Body.String())
	}
	missingTarget := requestJSON(t, router, http.MethodPost, "/api/lessons/missing/links", map[string]any{
		"target_type": models.LessonLinkTargetKnowledgeItem, "target_id": "missing",
	})
	if missingTarget.Code != http.StatusNotFound {
		t.Fatalf("missing target status = %d; body = %s", missingTarget.Code, missingTarget.Body.String())
	}
	missingQuery := requestJSON(t, router, http.MethodGet, "/api/lesson-links", nil)
	if missingQuery.Code != http.StatusBadRequest {
		t.Fatalf("missing query status = %d; body = %s", missingQuery.Code, missingQuery.Body.String())
	}
}
