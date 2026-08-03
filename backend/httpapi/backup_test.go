package httpapi_test

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"study-os/backend/app"
	"study-os/backend/backup"
	"study-os/backend/config"
	"study-os/backend/httpapi"
)

func TestBackupAPICreatesAndListsVerifiedManualBackup(t *testing.T) {
	dataDir := t.TempDir()
	application, err := app.New(context.Background(), app.Options{Config: config.Config{
		ListenAddress:  "127.0.0.1:0",
		DataDir:        dataDir,
		DBPath:         filepath.Join(dataDir, "study.db"),
		ActiveProvider: "mock",
	}})
	if err != nil {
		t.Fatalf("construct application: %v", err)
	}
	t.Cleanup(func() { _ = application.Close() })

	response := requestJSON(t, httpapi.NewRouter(application), http.MethodPost, "/api/backups", map[string]any{"category": "daily"})
	if response.Code != http.StatusCreated {
		t.Fatalf("create backup status = %d, body = %s", response.Code, response.Body.String())
	}
	var created struct {
		ID       string        `json:"id"`
		Category string        `json:"category"`
		Result   backup.Result `json:"result"`
	}
	if err := json.NewDecoder(response.Body).Decode(&created); err != nil {
		t.Fatalf("decode create backup response: %v", err)
	}
	if created.ID == "" || created.Category != "daily" || created.Result.Path == "" {
		t.Fatalf("unexpected create backup response: %#v", created)
	}
	if err := backup.VerifySQLite(created.Result.Path); err != nil {
		t.Fatalf("created backup is not verified sqlite: %v", err)
	}

	listResponse := requestJSON(t, httpapi.NewRouter(application), http.MethodGet, "/api/backups", nil)
	if listResponse.Code != http.StatusOK {
		t.Fatalf("list backups status = %d, body = %s", listResponse.Code, listResponse.Body.String())
	}
	var listed struct {
		Items []struct {
			ID   string `json:"id"`
			Path string `json:"path"`
		} `json:"items"`
	}
	if err := json.NewDecoder(listResponse.Body).Decode(&listed); err != nil {
		t.Fatalf("decode list backup response: %v", err)
	}
	if len(listed.Items) != 1 || listed.Items[0].ID != created.ID || listed.Items[0].Path != created.Result.Path {
		t.Fatalf("listed backups = %#v", listed.Items)
	}
}

func TestBackupAPIRejectsUnsupportedCategoryBeforeWriting(t *testing.T) {
	dataDir := t.TempDir()
	application, err := app.New(context.Background(), app.Options{Config: config.Config{
		ListenAddress:  "127.0.0.1:0",
		DataDir:        dataDir,
		DBPath:         filepath.Join(dataDir, "study.db"),
		ActiveProvider: "mock",
	}})
	if err != nil {
		t.Fatalf("construct application: %v", err)
	}
	t.Cleanup(func() { _ = application.Close() })

	response := requestJSON(t, httpapi.NewRouter(application), http.MethodPost, "/api/backups", map[string]any{"category": "unknown"})
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusBadRequest)
	}
	if _, err := os.Stat(filepath.Join(dataDir, "backups")); !os.IsNotExist(err) {
		t.Fatalf("backup directory was created for invalid request; err = %v", err)
	}
}
