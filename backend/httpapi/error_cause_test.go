package httpapi_test

import (
	"net/http"
	"net/url"
	"testing"

	"study-os/backend/config"
	"study-os/backend/httpapi"
	"study-os/backend/models"
)

func createErrorCause(t *testing.T, router http.Handler, body map[string]any) models.ErrorCause {
	t.Helper()
	response := requestJSON(t, router, http.MethodPost, "/api/error-causes", body)
	if response.Code != http.StatusCreated {
		t.Fatalf("create error cause = %d, body = %s", response.Code, response.Body.String())
	}
	var cause models.ErrorCause
	decodeJSON(t, response, &cause)
	return cause
}

func updateErrorCause(t *testing.T, router http.Handler, id string, body map[string]any) models.ErrorCause {
	t.Helper()
	response := requestJSON(t, router, http.MethodPatch, "/api/error-causes/"+url.PathEscape(id), body)
	if response.Code != http.StatusOK {
		t.Fatalf("update error cause = %d, body = %s", response.Code, response.Body.String())
	}
	var cause models.ErrorCause
	decodeJSON(t, response, &cause)
	return cause
}

func TestErrorCauseRoutesManageSubjectCandidatesWithoutPublishingThem(t *testing.T) {
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)

	defaults := requestJSON(t, router, http.MethodGet, "/api/error-causes?subject=physics", nil)
	if defaults.Code != http.StatusOK {
		t.Fatalf("list defaults = %d, body = %s", defaults.Code, defaults.Body.String())
	}
	var page struct {
		Items []models.ErrorCause `json:"items"`
		Count int                 `json:"count"`
	}
	decodeJSON(t, defaults, &page)
	if page.Count != 6 || len(page.Items) != 6 || page.Items[0].ID != "recall" {
		t.Fatalf("default page = %#v", page)
	}

	created := createErrorCause(t, router, map[string]any{
		"id": "physics:model-selection", "subject": "physics", "parent_id": "method",
		"label": "模型选择错误", "review_fixes": true,
		"action":      "重画受力图，再选择运动模型",
		"source_type": "learning_session", "source_id": "session-physics-1",
	})
	if created.Status != models.ErrorCauseStatusCandidate {
		t.Fatalf("created status = %q, want candidate", created.Status)
	}

	confirmedOnly := requestJSON(t, router, http.MethodGet, "/api/error-causes?subject=physics", nil)
	decodeJSON(t, confirmedOnly, &page)
	if page.Count != 6 {
		t.Fatalf("candidate leaked into operational list: %#v", page)
	}
	candidates := requestJSON(t, router, http.MethodGet, "/api/error-causes?subject=physics&status=candidate", nil)
	decodeJSON(t, candidates, &page)
	if candidates.Code != http.StatusOK || page.Count != 1 || page.Items[0].ID != created.ID {
		t.Fatalf("candidate page = %d %#v", candidates.Code, page)
	}

	confirmed := updateErrorCause(t, router, created.ID, map[string]any{
		"status": models.ErrorCauseStatusConfirmed,
		"action": "画受力图并做一道同模型变式题",
	})
	if confirmed.Status != models.ErrorCauseStatusConfirmed || !confirmed.ReviewFixes {
		t.Fatalf("confirmed = %#v", confirmed)
	}
	physics := requestJSON(t, router, http.MethodGet, "/api/error-causes?subject=physics", nil)
	decodeJSON(t, physics, &page)
	if page.Count != 7 {
		t.Fatalf("confirmed physics page = %#v", page)
	}
	geography := requestJSON(t, router, http.MethodGet, "/api/error-causes?subject=geography", nil)
	decodeJSON(t, geography, &page)
	if page.Count != 6 {
		t.Fatalf("physics cause leaked into geography page: %#v", page)
	}

	duplicate := requestJSON(t, router, http.MethodPost, "/api/error-causes", map[string]any{
		"id": created.ID, "subject": "physics", "label": "重复",
	})
	if duplicate.Code != http.StatusConflict {
		t.Fatalf("duplicate = %d, body = %s", duplicate.Code, duplicate.Body.String())
	}
}

func TestErrorCauseRoutesReclassifyOnlyWithConfirmedSubjectScope(t *testing.T) {
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)
	cause := createErrorCause(t, router, map[string]any{
		"id": "physics:model-selection", "subject": "physics", "parent_id": "method",
		"label": "模型选择错误",
	})
	physicsAttempt := fileMistake(t, router, map[string]any{
		"subject": "physics", "stem": "斜面上的物体如何运动？", "cause": "模型没选对",
	})

	candidate := requestJSON(t, router, http.MethodPatch,
		"/api/mistakes/"+physicsAttempt+"/cause", map[string]any{"cause": cause.ID})
	if candidate.Code != http.StatusBadRequest {
		t.Fatalf("candidate reclassification = %d, body = %s", candidate.Code, candidate.Body.String())
	}
	updateErrorCause(t, router, cause.ID, map[string]any{"status": models.ErrorCauseStatusConfirmed})
	reclassified := requestJSON(t, router, http.MethodPatch,
		"/api/mistakes/"+physicsAttempt+"/cause", map[string]any{"cause": cause.ID})
	if reclassified.Code != http.StatusOK {
		t.Fatalf("reclassify = %d, body = %s", reclassified.Code, reclassified.Body.String())
	}
	var mistake struct {
		Attempt struct {
			Cause string `json:"cause"`
		} `json:"attempt"`
	}
	decodeJSON(t, reclassified, &mistake)
	if mistake.Attempt.Cause != cause.ID {
		t.Fatalf("reclassified mistake = %#v", mistake)
	}

	geographyAttempt := fileMistake(t, router, map[string]any{
		"subject": "geography", "stem": "城市热岛效应", "cause": "unknown",
	})
	wrongSubject := requestJSON(t, router, http.MethodPatch,
		"/api/mistakes/"+geographyAttempt+"/cause", map[string]any{"cause": cause.ID})
	if wrongSubject.Code != http.StatusBadRequest {
		t.Fatalf("wrong-subject reclassification = %d, body = %s", wrongSubject.Code, wrongSubject.Body.String())
	}
}

func TestErrorCausePolicyDrivesMistakeScheduling(t *testing.T) {
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)
	cause := createErrorCause(t, router, map[string]any{
		"id": "physics:model-selection", "subject": "physics", "parent_id": "method",
		"label": "模型选择错误", "review_fixes": true,
	})
	candidateAttempt := fileMistake(t, router, map[string]any{
		"subject": "physics", "stem": "候选分类不能排队", "cause": cause.ID,
	})
	refused := requestJSON(t, router, http.MethodPost, "/api/mistakes/"+candidateAttempt+"/schedule", nil)
	if refused.Code != http.StatusBadRequest {
		t.Fatalf("candidate schedule = %d, body = %s", refused.Code, refused.Body.String())
	}

	updateErrorCause(t, router, cause.ID, map[string]any{"status": models.ErrorCauseStatusConfirmed})
	confirmedAttempt := fileMistake(t, router, map[string]any{
		"subject": "physics", "stem": "确认分类可以排队", "cause": cause.ID,
	})
	scheduled := requestJSON(t, router, http.MethodPost, "/api/mistakes/"+confirmedAttempt+"/schedule", nil)
	if scheduled.Code != http.StatusCreated {
		t.Fatalf("confirmed custom schedule = %d, body = %s", scheduled.Code, scheduled.Body.String())
	}
}

func TestErrorCauseRoutesRejectInvalidInput(t *testing.T) {
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)

	invalidStatus := requestJSON(t, router, http.MethodGet, "/api/error-causes?status=approved", nil)
	if invalidStatus.Code != http.StatusBadRequest {
		t.Fatalf("invalid status = %d, body = %s", invalidStatus.Code, invalidStatus.Body.String())
	}
	missingLabel := requestJSON(t, router, http.MethodPost, "/api/error-causes", map[string]any{
		"id": "physics:no-label", "subject": "physics",
	})
	if missingLabel.Code != http.StatusBadRequest {
		t.Fatalf("missing label = %d, body = %s", missingLabel.Code, missingLabel.Body.String())
	}
	missingCause := requestJSON(t, router, http.MethodPatch, "/api/error-causes/no-such-cause", map[string]any{
		"status": models.ErrorCauseStatusConfirmed,
	})
	if missingCause.Code != http.StatusNotFound {
		t.Fatalf("missing update = %d, body = %s", missingCause.Code, missingCause.Body.String())
	}
}
