package httpapi_test

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"study-os/backend/app"
	"study-os/backend/config"
	"study-os/backend/httpapi"
	"study-os/backend/models"
)

func TestQARecordGetReturnsNotFoundAsJSON(t *testing.T) {
	application := testApplication(t, config.Config{})

	response := requestJSON(t, httpapi.NewRouter(application), http.MethodGet, "/api/chat/records/missing-session", nil)

	if response.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusNotFound, response.Body.String())
	}
	if got := response.Header().Get("Content-Type"); !strings.Contains(got, "application/json") {
		t.Fatalf("content type = %q, want JSON", got)
	}
	var body map[string]string
	decodeJSON(t, response, &body)
	if body["error"] == "" {
		t.Fatalf("error response = %#v", body)
	}
}

func TestQARecordPutCreatesAndUpdatesStableIdentity(t *testing.T) {
	application := testApplication(t, config.Config{})
	seedQARecordChatSession(t, application, "session-qa", "physics")
	router := httpapi.NewRouter(application)

	createdResponse := requestJSON(t, router, http.MethodPut, "/api/chat/records/session-qa", map[string]any{
		"subject":                "physics",
		"original_understanding": "A larger force always means a larger velocity.",
		"corrected_model":        "Net force determines acceleration.",
		"mastery_evidence":       "I solved a transfer problem.",
		"unresolved":             "How does drag change the model?",
	})
	if createdResponse.Code != http.StatusOK {
		t.Fatalf("create status = %d, want %d; body = %s", createdResponse.Code, http.StatusOK, createdResponse.Body.String())
	}
	var created models.QARecord
	decodeJSON(t, createdResponse, &created)
	if !strings.HasPrefix(created.ID, "qa-") || created.SessionID != "session-qa" {
		t.Fatalf("created identity = %#v", created)
	}
	if created.Status != models.QARecordStatusOpen {
		t.Fatalf("created status = %q, want %q", created.Status, models.QARecordStatusOpen)
	}
	if created.CreatedAt.IsZero() || created.UpdatedAt.IsZero() {
		t.Fatalf("created timestamps = (%v, %v)", created.CreatedAt, created.UpdatedAt)
	}

	time.Sleep(2 * time.Millisecond)
	updatedResponse := requestJSON(t, router, http.MethodPut, "/api/chat/records/session-qa", map[string]any{
		"subject":                "physics",
		"context_type":           "",
		"context_id":             "",
		"original_understanding": created.OriginalUnderstanding,
		"corrected_model":        "The vector sum of forces determines acceleration.",
		"mastery_evidence":       "I explained an inclined-plane example.",
		"unresolved":             "",
		"status":                 models.QARecordStatusUnderstood,
	})
	if updatedResponse.Code != http.StatusOK {
		t.Fatalf("update status = %d, want %d; body = %s", updatedResponse.Code, http.StatusOK, updatedResponse.Body.String())
	}
	var updated models.QARecord
	decodeJSON(t, updatedResponse, &updated)
	if updated.ID != created.ID {
		t.Fatalf("updated id = %q, want %q", updated.ID, created.ID)
	}
	if !updated.CreatedAt.Equal(created.CreatedAt) {
		t.Fatalf("updated created_at = %v, want %v", updated.CreatedAt, created.CreatedAt)
	}
	if !updated.UpdatedAt.After(created.UpdatedAt) {
		t.Fatalf("updated_at = %v, want after %v", updated.UpdatedAt, created.UpdatedAt)
	}
	if updated.Status != models.QARecordStatusUnderstood || updated.Unresolved != "" {
		t.Fatalf("updated record = %#v", updated)
	}

	getResponse := requestJSON(t, router, http.MethodGet, "/api/chat/records/session-qa", nil)
	if getResponse.Code != http.StatusOK {
		t.Fatalf("get status = %d, want %d; body = %s", getResponse.Code, http.StatusOK, getResponse.Body.String())
	}
	var fetched models.QARecord
	decodeJSON(t, getResponse, &fetched)
	if fetched.ID != created.ID || fetched.CorrectedModel != updated.CorrectedModel {
		t.Fatalf("fetched record = %#v", fetched)
	}
}

func TestQARecordRoutesDecodeEscapedSessionIDOnce(t *testing.T) {
	application := testApplication(t, config.Config{})
	seedQARecordChatSession(t, application, "session/qa", "physics")
	seedQARecordChatSession(t, application, "session%2Fqa", "physics")
	router := httpapi.NewRouter(application)

	created := requestJSON(t, router, http.MethodPut, "/api/chat/records/session%2Fqa", map[string]any{
		"subject": "physics", "corrected_model": "Net force determines acceleration.",
	})
	if created.Code != http.StatusOK {
		t.Fatalf("escaped create status = %d, want %d; body = %s", created.Code, http.StatusOK, created.Body.String())
	}
	var record models.QARecord
	decodeJSON(t, created, &record)
	if record.SessionID != "session/qa" {
		t.Fatalf("session id = %q, want decoded value", record.SessionID)
	}

	fetched := requestJSON(t, router, http.MethodGet, "/api/chat/records/session%2Fqa", nil)
	if fetched.Code != http.StatusOK {
		t.Fatalf("escaped get status = %d, want %d; body = %s", fetched.Code, http.StatusOK, fetched.Body.String())
	}

	literalPercent := requestJSON(t, router, http.MethodPut, "/api/chat/records/session%252Fqa", map[string]any{
		"subject": "physics", "corrected_model": "A literal percent sequence stays literal.",
	})
	if literalPercent.Code != http.StatusOK {
		t.Fatalf("double escaped create status = %d, want %d; body = %s", literalPercent.Code, http.StatusOK, literalPercent.Body.String())
	}
	decodeJSON(t, literalPercent, &record)
	if record.SessionID != "session%2Fqa" {
		t.Fatalf("literal percent session id = %q, want one decode only", record.SessionID)
	}
}

func TestQARecordPutRejectsInvalidAndNonCanonicalBodies(t *testing.T) {
	application := testApplication(t, config.Config{})
	seedQARecordChatSession(t, application, "session-invalid", "physics")
	router := httpapi.NewRouter(application)

	tests := []struct {
		name string
		body any
	}{
		{name: "malformed JSON", body: rawJSON(`{"subject":`)},
		{name: "invalid status", body: map[string]any{"subject": "physics", "status": "complete"}},
		{name: "unpaired context", body: map[string]any{"subject": "physics", "context_type": models.QARecordContextLesson}},
		{name: "client owned id", body: map[string]any{"id": "client-id", "subject": "physics"}},
		{name: "unknown field", body: map[string]any{"subject": "physics", "extra": true}},
	}
	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			response := requestQARecordBody(t, router, "/api/chat/records/session-invalid", testCase.body)
			if response.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusBadRequest, response.Body.String())
			}
		})
	}
}

func TestQARecordPutReturnsNotFoundForMissingReferences(t *testing.T) {
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)

	missingSession := requestJSON(t, router, http.MethodPut, "/api/chat/records/missing-session", map[string]any{
		"subject": "physics",
	})
	if missingSession.Code != http.StatusNotFound {
		t.Fatalf("missing session status = %d, want %d; body = %s", missingSession.Code, http.StatusNotFound, missingSession.Body.String())
	}

	seedQARecordChatSession(t, application, "session-context", "physics")
	missingContext := requestJSON(t, router, http.MethodPut, "/api/chat/records/session-context", map[string]any{
		"subject":      "physics",
		"context_type": models.QARecordContextKnowledgeItem,
		"context_id":   "missing-knowledge",
	})
	if missingContext.Code != http.StatusNotFound {
		t.Fatalf("missing context status = %d, want %d; body = %s", missingContext.Code, http.StatusNotFound, missingContext.Body.String())
	}
}

func TestQARecordEndpointsReturnServiceUnavailableWithoutStore(t *testing.T) {
	router := httpapi.NewRouter(nil)

	for _, testCase := range []struct {
		method string
		body   any
	}{
		{method: http.MethodGet},
		{method: http.MethodPut, body: map[string]any{"subject": "physics"}},
	} {
		response := requestJSON(t, router, testCase.method, "/api/chat/records/session-qa", testCase.body)
		if response.Code != http.StatusServiceUnavailable {
			t.Errorf("%s status = %d, want %d; body = %s", testCase.method, response.Code, http.StatusServiceUnavailable, response.Body.String())
		}
	}
}

func TestQARecordRoutesRejectMissingSessionID(t *testing.T) {
	router := httpapi.NewRouter(testApplication(t, config.Config{}))
	for _, target := range []string{"/api/chat/records", "/api/chat/records/"} {
		for _, method := range []string{http.MethodGet, http.MethodPut} {
			response := requestJSON(t, router, method, target, map[string]any{"subject": "physics"})
			if response.Code != http.StatusBadRequest {
				t.Errorf("%s %s status = %d, want %d; body = %s", method, target, response.Code, http.StatusBadRequest, response.Body.String())
			}
		}
	}
}

type rawJSON string

func requestQARecordBody(t *testing.T, handler http.Handler, target string, body any) *httptest.ResponseRecorder {
	t.Helper()
	if raw, ok := body.(rawJSON); ok {
		request := httptest.NewRequest(http.MethodPut, "http://127.0.0.1"+target, bytes.NewBufferString(string(raw)))
		request.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		return response
	}
	return requestJSON(t, handler, http.MethodPut, target, body)
}

func seedQARecordChatSession(t *testing.T, application *app.App, sessionID, subject string) {
	t.Helper()
	if err := application.Store.CreateChatMessage(t.Context(), models.ChatMessage{
		ID: "message-" + sessionID, SessionID: sessionID, Subject: subject,
		Role: "user", Content: "Explain this.", Status: "done",
	}); err != nil {
		t.Fatalf("create chat session %q: %v", sessionID, err)
	}
}
