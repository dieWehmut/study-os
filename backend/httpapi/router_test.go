package httpapi_test

import (
	"bytes"
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

func TestRouterRejectsUntrustedBrowserOrigin(t *testing.T) {
	application, err := app.New(context.Background(), app.Options{
		DBPath: filepath.Join(t.TempDir(), "study.db"),
	})
	if err != nil {
		t.Fatalf("construct application: %v", err)
	}
	t.Cleanup(func() { _ = application.Close() })

	request := httptest.NewRequest(http.MethodPost, "http://127.0.0.1/api/demo/seed", nil)
	request.Header.Set("Origin", "https://attacker.example")
	response := httptest.NewRecorder()
	httpapi.NewRouter(application).ServeHTTP(response, request)

	if response.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusForbidden)
	}
}

func TestRouterAllowsLoopbackAndWailsOrigins(t *testing.T) {
	application, err := app.New(context.Background(), app.Options{
		DBPath: filepath.Join(t.TempDir(), "study.db"),
	})
	if err != nil {
		t.Fatalf("construct application: %v", err)
	}
	t.Cleanup(func() { _ = application.Close() })
	router := httpapi.NewRouter(application)

	for _, origin := range []string{"http://localhost:5173", "http://127.0.0.1:5173", "http://wails.localhost", "wails://wails"} {
		request := httptest.NewRequest(http.MethodGet, "http://127.0.0.1/api/health", nil)
		request.Header.Set("Origin", origin)
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		if response.Code != http.StatusOK {
			t.Errorf("origin %q status = %d, want %d", origin, response.Code, http.StatusOK)
		}
	}
}

func TestImportPreviewRejectsOversizedJSONBody(t *testing.T) {
	application, err := app.New(context.Background(), app.Options{
		DBPath: filepath.Join(t.TempDir(), "study.db"),
	})
	if err != nil {
		t.Fatalf("construct application: %v", err)
	}
	t.Cleanup(func() { _ = application.Close() })

	body := bytes.Repeat([]byte("x"), 70<<10)
	request := httptest.NewRequest(http.MethodPost, "http://127.0.0.1/api/imports/missing/preview", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	httpapi.NewRouter(application).ServeHTTP(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusBadRequest, response.Body.String())
	}
}
