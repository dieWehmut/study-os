package httpapi_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"study-os/backend/app"
	"study-os/backend/config"
	"study-os/backend/httpapi"
)

func TestSystemStatusRedactsProviderSecretAndReportsLocalState(t *testing.T) {
	dataDir := t.TempDir()
	application, err := app.New(context.Background(), app.Options{Config: config.Config{
		ListenAddress:  "127.0.0.1:8080",
		DataDir:        dataDir,
		DBPath:         filepath.Join(dataDir, "study.db"),
		ActiveProvider: "deepseek",
		AI: map[string]config.VendorConfig{
			"deepseek": {
				APIKey:  "test-secret-key",
				BaseURL: "https://example.test/v1",
				Model:   "test-model",
			},
		},
	}})
	if err != nil {
		t.Fatalf("construct application: %v", err)
	}
	t.Cleanup(func() { _ = application.Close() })
	if err := application.Store.SetSetting(context.Background(), "daily_limit", "37"); err != nil {
		t.Fatalf("set daily limit: %v", err)
	}

	request := httptest.NewRequest(http.MethodGet, "http://127.0.0.1/api/system/status", nil)
	response := httptest.NewRecorder()
	httpapi.NewRouter(application).ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if strings.Contains(response.Body.String(), "test-secret-key") {
		t.Fatal("system status leaked provider secret")
	}
	var body struct {
		Provider struct {
			Name          string `json:"name"`
			Configured    bool   `json:"configured"`
			Available     bool   `json:"available"`
			KeyConfigured bool   `json:"key_configured"`
			Model         string `json:"model"`
		} `json:"provider"`
		Data struct {
			Directory    string `json:"directory"`
			DatabasePath string `json:"database_path"`
		} `json:"data"`
		Review struct {
			DailyLimit int `json:"daily_limit"`
		} `json:"review"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.Provider.Name != "deepseek" || !body.Provider.Configured || !body.Provider.Available || !body.Provider.KeyConfigured || body.Provider.Model != "test-model" {
		t.Fatalf("provider status = %#v", body.Provider)
	}
	if body.Data.Directory != dataDir || body.Data.DatabasePath != filepath.Join(dataDir, "study.db") {
		t.Fatalf("data status = %#v", body.Data)
	}
	if body.Review.DailyLimit != 37 {
		t.Fatalf("daily limit = %d, want 37", body.Review.DailyLimit)
	}
}

func TestPatchSettingsRejectsOversizedBody(t *testing.T) {
	application, err := app.New(context.Background(), app.Options{DBPath: filepath.Join(t.TempDir(), "study.db")})
	if err != nil {
		t.Fatalf("construct application: %v", err)
	}
	t.Cleanup(func() { _ = application.Close() })
	body := `{"daily_limit":42}` + strings.Repeat(" ", 65<<10)
	request := httptest.NewRequest(http.MethodPatch, "http://127.0.0.1/api/settings", bytes.NewBufferString(body))
	response := httptest.NewRecorder()
	httpapi.NewRouter(application).ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, body = %s; want bounded request rejection", response.Code, response.Body.String())
	}
}

func TestPatchSettingsPersistsValidatedDailyLimit(t *testing.T) {
	application, err := app.New(context.Background(), app.Options{DBPath: filepath.Join(t.TempDir(), "study.db")})
	if err != nil {
		t.Fatalf("construct application: %v", err)
	}
	t.Cleanup(func() { _ = application.Close() })
	router := httpapi.NewRouter(application)

	request := httptest.NewRequest(http.MethodPatch, "http://127.0.0.1/api/settings", bytes.NewBufferString(`{"daily_limit":42}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	value, err := application.Store.GetSetting(context.Background(), "daily_limit")
	if err != nil || value != "42" {
		t.Fatalf("stored daily limit = %q, err = %v", value, err)
	}

	badRequest := httptest.NewRequest(http.MethodPatch, "http://127.0.0.1/api/settings", bytes.NewBufferString(`{"daily_limit":0}`))
	badRequest.Header.Set("Content-Type", "application/json")
	badResponse := httptest.NewRecorder()
	router.ServeHTTP(badResponse, badRequest)
	if badResponse.Code != http.StatusBadRequest {
		t.Fatalf("invalid status = %d, want %d", badResponse.Code, http.StatusBadRequest)
	}
}

func TestPatchSettingsMapsCanceledWrite(t *testing.T) {
	application, err := app.New(context.Background(), app.Options{DBPath: filepath.Join(t.TempDir(), "study.db")})
	if err != nil {
		t.Fatalf("construct application: %v", err)
	}
	t.Cleanup(func() { _ = application.Close() })
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	request := httptest.NewRequest(http.MethodPatch, "http://127.0.0.1/api/settings", bytes.NewBufferString(`{"daily_limit":42}`)).WithContext(ctx)
	response := httptest.NewRecorder()
	httpapi.NewRouter(application).ServeHTTP(response, request)
	if response.Code != http.StatusRequestTimeout {
		t.Fatalf("status = %d, body = %s; want request timeout", response.Code, response.Body.String())
	}
}
