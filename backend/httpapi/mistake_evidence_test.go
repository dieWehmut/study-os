package httpapi_test

import (
	"encoding/json"
	"net/http"
	"testing"

	"study-os/backend/config"
	"study-os/backend/httpapi"
)

func TestMistakeEvidenceEndpointPersistsAndReturnsSubjectArtifact(t *testing.T) {
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)

	filed := requestJSON(t, router, http.MethodPost, "/api/mistakes", map[string]any{
		"subject": "geography",
		"stem":    "说明城市化影响径流的过程",
		"cause":   "method",
		"evidence": map[string]any{
			"version": 1,
			"subject": "geography",
			"tool":    "causal_chain",
			"data":    map[string]any{"links": []map[string]string{{"cause": "城市化", "effect": "下垫面硬化"}}},
		},
	})
	if filed.Code != http.StatusCreated {
		t.Fatalf("file mistake = %d, body = %s", filed.Code, filed.Body.String())
	}
	var created struct {
		Attempt struct {
			ID       string          `json:"id"`
			Evidence json.RawMessage `json:"evidence"`
		} `json:"attempt"`
	}
	decodeJSON(t, filed, &created)
	if created.Attempt.ID == "" || len(created.Attempt.Evidence) == 0 {
		t.Fatalf("created = %#v", created)
	}

	patched := requestJSON(t, router, http.MethodPatch, "/api/mistakes/"+created.Attempt.ID+"/evidence", map[string]any{
		"evidence": map[string]any{
			"version": 1,
			"subject": "geography",
			"tool":    "causal_chain",
			"data": map[string]any{"links": []map[string]string{
				{"cause": "城市化", "effect": "下垫面硬化"},
				{"cause": "下垫面硬化", "effect": "下渗减少"},
			}},
		},
	})
	if patched.Code != http.StatusOK {
		t.Fatalf("patch evidence = %d, body = %s", patched.Code, patched.Body.String())
	}
	var updated struct {
		Attempt struct {
			Evidence struct {
				Subject string `json:"subject"`
				Tool    string `json:"tool"`
				Data    struct {
					Links []map[string]string `json:"links"`
				} `json:"data"`
			} `json:"evidence"`
		} `json:"attempt"`
	}
	decodeJSON(t, patched, &updated)
	if updated.Attempt.Evidence.Subject != "geography" || updated.Attempt.Evidence.Tool != "causal_chain" || len(updated.Attempt.Evidence.Data.Links) != 2 {
		t.Fatalf("updated = %#v", updated)
	}
}

func TestMistakeEvidenceEndpointRejectsCrossSubjectToolsAndMissingRows(t *testing.T) {
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)
	filed := requestJSON(t, router, http.MethodPost, "/api/mistakes", map[string]any{
		"subject": "chinese", "stem": "赏析句子", "cause": "method",
	})
	var created struct {
		Attempt struct {
			ID string `json:"id"`
		} `json:"attempt"`
	}
	decodeJSON(t, filed, &created)

	wrong := requestJSON(t, router, http.MethodPatch, "/api/mistakes/"+created.Attempt.ID+"/evidence", map[string]any{
		"evidence": map[string]any{
			"version": 1, "subject": "physics", "tool": "free_body",
			"data": map[string]any{"forces": []map[string]any{{"id": "g", "name": "重力", "magnitude": 10, "angle": 270, "kind": "field"}}},
		},
	})
	if wrong.Code != http.StatusBadRequest {
		t.Fatalf("cross-subject evidence = %d, body = %s", wrong.Code, wrong.Body.String())
	}

	missing := requestJSON(t, router, http.MethodPatch, "/api/mistakes/missing/evidence", map[string]any{
		"evidence": map[string]any{
			"version": 1, "subject": "math", "tool": "derivation",
			"data": map[string]any{"lines": []string{"x+1=2", "x=1"}},
		},
	})
	if missing.Code != http.StatusNotFound {
		t.Fatalf("missing evidence target = %d, body = %s", missing.Code, missing.Body.String())
	}
}
