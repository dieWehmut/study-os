package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"study-os/backend/backup"
	"study-os/backend/db"
)

func TestRequireBearerRejectsMissingToken(t *testing.T) {
	t.Parallel()

	handler := requireBearer("secret", http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	request := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
}

func TestRequireBearerAllowsMatchingToken(t *testing.T) {
	t.Parallel()

	handler := requireBearer("secret", http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	request := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	request.Header.Set("Authorization", "Bearer secret")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusNoContent)
	}
}

func TestDesktopAPIHandlerAnswersAllowedCORSPreflightWithoutBearer(t *testing.T) {
	t.Parallel()

	handler := desktopAPIHandler("secret", http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusTeapot)
	}))
	request := httptest.NewRequest(http.MethodOptions, "/api/health", nil)
	request.Header.Set("Origin", "http://wails.localhost")
	request.Header.Set("Access-Control-Request-Method", http.MethodGet)
	request.Header.Set("Access-Control-Request-Headers", "authorization, x-study-os-request")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusNoContent)
	}
	if got := response.Header().Get("Access-Control-Allow-Origin"); got != "http://wails.localhost" {
		t.Fatalf("allow origin = %q", got)
	}
	if got := response.Header().Get("Access-Control-Allow-Headers"); got != "Authorization, Content-Type, X-Study-OS-Request" {
		t.Fatalf("allow headers = %q", got)
	}
}

func TestDesktopAPIHandlerRejectsUnknownOrigin(t *testing.T) {
	t.Parallel()

	handler := desktopAPIHandler("secret", http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	request := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	request.Header.Set("Origin", "https://example.invalid")
	request.Header.Set("Authorization", "Bearer secret")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusForbidden)
	}
}

func TestDesktopAPIHandlerRejectsNonHTTPLoopbackOrigin(t *testing.T) {
	t.Parallel()

	handler := desktopAPIHandler("secret", http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	request := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	request.Header.Set("Origin", "ftp://127.0.0.1:5173")
	request.Header.Set("Authorization", "Bearer secret")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusForbidden)
	}
}

func TestDesktopAPIHandlerAllowsLoopbackOriginsForWailsDev(t *testing.T) {
	t.Parallel()

	handler := desktopAPIHandler("secret", http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	for _, origin := range []string{"http://localhost:5173", "http://127.0.0.1:5173", "http://[::1]:5173"} {
		request := httptest.NewRequest(http.MethodGet, "/api/health", nil)
		request.Header.Set("Origin", origin)
		request.Header.Set("Authorization", "Bearer secret")
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusNoContent {
			t.Errorf("origin %q status = %d, want %d", origin, response.Code, http.StatusNoContent)
		}
		if got := response.Header().Get("Access-Control-Allow-Origin"); got != origin {
			t.Errorf("origin %q allow header = %q", origin, got)
		}
	}
}

func TestDesktopStartupCreatesOneDailyBackupPerDay(t *testing.T) {
	dataDir := t.TempDir()
	envPath := filepath.Join(t.TempDir(), ".env.local")
	contents := "STUDY_OS_DATA_DIR=" + dataDir + "\nAI_PROVIDER=mock\n"
	if err := os.WriteFile(envPath, []byte(contents), 0o600); err != nil {
		t.Fatalf("write test env: %v", err)
	}
	t.Setenv("STUDY_OS_ENV_FILE", envPath)

	for attempt := 0; attempt < 2; attempt++ {
		application := NewDesktopApp()
		application.Startup(context.Background())
		if _, err := application.APIBaseURL(); err != nil {
			t.Fatalf("desktop startup %d: %v", attempt+1, err)
		}
		application.Shutdown(context.Background())
	}

	entries, err := os.ReadDir(filepath.Join(dataDir, "backups", string(backup.Daily)))
	if err != nil {
		t.Fatalf("read daily backups: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("daily backup count = %d, want 1", len(entries))
	}
	if entries[0].IsDir() {
		t.Fatal("daily backup entry is a directory")
	}
	if err := backup.VerifySQLite(filepath.Join(dataDir, "backups", string(backup.Daily), entries[0].Name())); err != nil {
		t.Fatalf("verify startup backup: %v", err)
	}
	store, err := db.Open(context.Background(), filepath.Join(dataDir, "study.db"))
	if err != nil {
		t.Fatalf("open store to simulate missing metadata: %v", err)
	}
	if _, err := store.SQL().Exec(`DELETE FROM backup_records`); err != nil {
		_ = store.Close()
		t.Fatalf("delete startup backup metadata: %v", err)
	}
	if err := store.Close(); err != nil {
		t.Fatalf("close metadata store: %v", err)
	}

	application := NewDesktopApp()
	application.Startup(context.Background())
	if _, err := application.APIBaseURL(); err != nil {
		t.Fatalf("desktop startup for metadata check: %v", err)
	}
	defer application.Shutdown(context.Background())
	var records int
	if err := application.application.Store.SQL().QueryRow(`SELECT COUNT(*) FROM backup_records`).Scan(&records); err != nil {
		t.Fatalf("count startup backup records: %v", err)
	}
	if records != 1 {
		t.Fatalf("startup backup record count = %d, want 1", records)
	}
}
