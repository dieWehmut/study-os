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

func TestProviderStatusAndMockGenerationStayOffline(t *testing.T) {
	dataDir := t.TempDir()
	application, err := app.New(context.Background(), app.Options{Config: config.Config{
		ListenAddress:  "127.0.0.1:8080",
		DataDir:        dataDir,
		DBPath:         filepath.Join(dataDir, "study.db"),
		ActiveProvider: "mock",
	}})
	if err != nil {
		t.Fatalf("construct application: %v", err)
	}
	t.Cleanup(func() { _ = application.Close() })
	router := httpapi.NewRouter(application)

	statusRequest := httptest.NewRequest(http.MethodGet, "http://127.0.0.1/api/agent/status", nil)
	statusResponse := httptest.NewRecorder()
	router.ServeHTTP(statusResponse, statusRequest)
	if statusResponse.Code != http.StatusOK || !strings.Contains(statusResponse.Body.String(), `"provider":"mock"`) {
		t.Fatalf("status = %d, body = %s", statusResponse.Code, statusResponse.Body.String())
	}

	body := `{"kind":"summary","summary":{"title":"Cells","text":"Cells are basic units. They contain genetic material.","max_key_points":1}}`
	request := httptest.NewRequest(http.MethodPost, "http://127.0.0.1/api/agent/generate", bytes.NewBufferString(body))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("generate status = %d, body = %s", response.Code, response.Body.String())
	}
	var generated struct {
		Kind    string `json:"kind"`
		Summary struct {
			Title     string   `json:"title"`
			KeyPoints []string `json:"key_points"`
		} `json:"summary"`
	}
	if err := json.NewDecoder(response.Body).Decode(&generated); err != nil {
		t.Fatalf("decode generation: %v", err)
	}
	if generated.Kind != "summary" || generated.Summary.Title != "Cells" || len(generated.Summary.KeyPoints) != 1 {
		t.Fatalf("generated response = %#v", generated)
	}
}

// A rejected upstream call must never echo the credential back to the browser,
// and a configured vendor must still report itself available. Both protocols are
// exercised because each builds its own request and error path.
func TestHostedProviderEndpointNeverLeaksKey(t *testing.T) {
	for _, testCase := range []struct {
		vendor string
		envelope string
	}{
		{vendor: "deepseek", envelope: `{"error":{"message":"bad key"}}`},
		{vendor: "claude", envelope: `{"type":"error","error":{"type":"authentication_error","message":"bad key"}}`},
	} {
		t.Run(testCase.vendor, func(t *testing.T) {
			dataDir := t.TempDir()
			server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
				response.WriteHeader(http.StatusUnauthorized)
				_, _ = response.Write([]byte(testCase.envelope))
			}))
			defer server.Close()
			application, err := app.New(context.Background(), app.Options{Config: config.Config{
				ListenAddress:  "127.0.0.1:8080",
				DataDir:        dataDir,
				DBPath:         filepath.Join(dataDir, "study.db"),
				ActiveProvider: testCase.vendor,
				AI: map[string]config.VendorConfig{
					testCase.vendor: {
						APIKey:  "test-secret-key",
						BaseURL: server.URL,
					},
				},
			}})
			if err != nil {
				t.Fatalf("construct application: %v", err)
			}
			t.Cleanup(func() { _ = application.Close() })

			request := httptest.NewRequest(http.MethodPost, "http://127.0.0.1/api/agent/generate", bytes.NewBufferString(`{"kind":"summary","summary":{"text":"offline"}}`))
			request.Header.Set("Content-Type", "application/json")
			response := httptest.NewRecorder()
			httpapi.NewRouter(application).ServeHTTP(response, request)
			if response.Code != http.StatusServiceUnavailable {
				t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
			}
			if strings.Contains(response.Body.String(), "test-secret-key") {
				t.Fatal("provider endpoint leaked key")
			}

			statusRequest := httptest.NewRequest(http.MethodGet, "http://127.0.0.1/api/agent/status", nil)
			statusResponse := httptest.NewRecorder()
			httpapi.NewRouter(application).ServeHTTP(statusResponse, statusRequest)
			if !strings.Contains(statusResponse.Body.String(), `"configured":true`) || !strings.Contains(statusResponse.Body.String(), `"available":true`) {
				t.Fatalf("configured credentials must report as available: %s", statusResponse.Body.String())
			}
		})
	}
}
