package httpapi_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"study-os/backend/app"
	"study-os/backend/httpapi"
)

func TestHealth(t *testing.T) {
	application, err := app.New(context.Background(), app.Options{
		DBPath: filepath.Join(t.TempDir(), "study.db"),
	})
	if err != nil {
		t.Fatalf("construct application: %v", err)
	}
	t.Cleanup(func() {
		if err := application.Close(); err != nil {
			t.Errorf("close application: %v", err)
		}
	})

	request := httptest.NewRequest(http.MethodGet, "http://127.0.0.1/api/health", nil)
	response := httptest.NewRecorder()
	httpapi.NewRouter(application).ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusOK, response.Body.String())
	}

	var body struct {
		Status string `json:"status"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode health response: %v", err)
	}
	if body.Status != "ok" {
		t.Fatalf("status field = %q, want %q", body.Status, "ok")
	}
}

func TestRouterRejectsNonLoopbackHost(t *testing.T) {
	application, err := app.New(context.Background(), app.Options{
		DBPath: filepath.Join(t.TempDir(), "study.db"),
	})
	if err != nil {
		t.Fatalf("construct application: %v", err)
	}
	t.Cleanup(func() { _ = application.Close() })

	request := httptest.NewRequest(http.MethodGet, "http://example.com/api/health", nil)
	response := httptest.NewRecorder()
	httpapi.NewRouter(application).ServeHTTP(response, request)

	if response.Code != http.StatusMisdirectedRequest {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusMisdirectedRequest)
	}
}
