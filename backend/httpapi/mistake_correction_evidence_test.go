package httpapi_test

import (
	"net/http"
	"testing"

	"study-os/backend/config"
	"study-os/backend/httpapi"
)

func TestMistakeCorrectionEndpointCarriesAnswerAndElapsedEvidence(t *testing.T) {
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)

	filed := requestJSON(t, router, http.MethodPost, "/api/mistakes", map[string]any{
		"subject": "physics", "stem": "F = ma", "cause": "method", "answer": " 5 N ", "elapsed_ms": 900,
	})
	if filed.Code != http.StatusCreated {
		t.Fatalf("file = %d, body = %s", filed.Code, filed.Body.String())
	}
	var created struct {
		Attempt struct {
			ID        string `json:"id"`
			Answer    string `json:"answer"`
			ElapsedMS int    `json:"elapsed_ms"`
		} `json:"attempt"`
	}
	decodeJSON(t, filed, &created)
	if created.Attempt.Answer != "5 N" || created.Attempt.ElapsedMS != 900 {
		t.Fatalf("initial evidence = %#v", created.Attempt)
	}

	corrected := requestJSON(t, router, http.MethodPost, "/api/mistakes/"+created.Attempt.ID+"/correct", map[string]any{
		"answer": " 6 N ", "elapsed_ms": 4200,
	})
	if corrected.Code != http.StatusOK {
		t.Fatalf("correct = %d, body = %s", corrected.Code, corrected.Body.String())
	}
	var result struct {
		Corrected  bool `json:"corrected"`
		Correction struct {
			Answer    string `json:"answer"`
			ElapsedMS int    `json:"elapsed_ms"`
			IsCorrect bool   `json:"is_correct"`
		} `json:"correction"`
	}
	decodeJSON(t, corrected, &result)
	if !result.Corrected || result.Correction.Answer != "6 N" || result.Correction.ElapsedMS != 4200 || !result.Correction.IsCorrect {
		t.Fatalf("correction = %#v, body = %s", result, corrected.Body.String())
	}

	again := requestJSON(t, router, http.MethodPost, "/api/mistakes/"+created.Attempt.ID+"/correct", map[string]any{
		"answer": "7 N", "elapsed_ms": 5000,
	})
	var repeated struct {
		Correction struct {
			Answer string `json:"answer"`
		} `json:"correction"`
	}
	decodeJSON(t, again, &repeated)
	if again.Code != http.StatusOK || repeated.Correction.Answer != "6 N" {
		t.Fatalf("repeat correction = %d %#v, body = %s", again.Code, repeated, again.Body.String())
	}
}

func TestMistakeCorrectionEndpointRejectsMissingEvidence(t *testing.T) {
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)
	filed := requestJSON(t, router, http.MethodPost, "/api/mistakes", map[string]any{
		"subject": "physics", "stem": "F = ma", "cause": "method",
	})
	var created struct {
		Attempt struct {
			ID string `json:"id"`
		} `json:"attempt"`
	}
	decodeJSON(t, filed, &created)

	for _, input := range []map[string]any{
		{"answer": "   ", "elapsed_ms": 1},
		{"answer": "6 N", "elapsed_ms": -1},
	} {
		refused := requestJSON(t, router, http.MethodPost, "/api/mistakes/"+created.Attempt.ID+"/correct", input)
		if refused.Code != http.StatusBadRequest {
			t.Fatalf("invalid correction %v = %d, body = %s", input, refused.Code, refused.Body.String())
		}
	}
}
