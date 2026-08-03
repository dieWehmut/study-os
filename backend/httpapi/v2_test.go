package httpapi_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"study-os/backend/app"
	"study-os/backend/audio"
	"study-os/backend/config"
	"study-os/backend/httpapi"
	"study-os/backend/models"
)

func testApplication(t *testing.T, cfg config.Config) *app.App {
	t.Helper()
	if cfg.ListenAddress == "" {
		cfg.ListenAddress = "127.0.0.1:8080"
	}
	if cfg.DataDir == "" {
		cfg.DataDir = t.TempDir()
	}
	if cfg.DBPath == "" {
		cfg.DBPath = filepath.Join(cfg.DataDir, "study.db")
	}
	if cfg.ActiveProvider == "" {
		cfg.ActiveProvider = "mock"
	}
	application, err := app.New(context.Background(), app.Options{Config: cfg})
	if err != nil {
		t.Fatalf("construct application: %v", err)
	}
	t.Cleanup(func() { _ = application.Close() })
	return application
}

func TestVendorListEndpointNeverLeaksKey(t *testing.T) {
	dataDir := t.TempDir()
	application := testApplication(t, config.Config{
		DataDir:        dataDir,
		ActiveProvider: "deepseek",
		DeepSeek: config.DeepSeekConfig{
			APIKey:  "sk-test-secret",
			BaseURL: "https://api.deepseek.com/v1",
			Model:   "deepseek-v4-flash",
		},
	})
	response := requestJSON(t, httpapi.NewRouter(application), http.MethodGet, "/api/agent/vendors", nil)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	body := response.Body.String()
	if strings.Contains(body, "sk-test-secret") {
		t.Fatalf("vendor list leaked the API key: %s", body)
	}
	if !strings.Contains(body, `"id":"deepseek"`) || !strings.Contains(body, `"implemented":true`) || !strings.Contains(body, `"key_configured":true`) || !strings.Contains(body, `"active":true`) {
		t.Fatalf("deepseek vendor status missing: %s", body)
	}
	if !strings.Contains(body, `"id":"qwen","display_name":"通义千问（百炼）","implemented":false`) {
		t.Fatalf("placeholder vendor must appear unimplemented: %s", body)
	}
}

func TestActiveProviderEndpointRewritesEnvFile(t *testing.T) {
	envPath := filepath.Join(t.TempDir(), ".env.local")
	if err := os.WriteFile(envPath, []byte("AI_ACTIVE_PROVIDER=mock\nDEEPSEEK_API_KEY=keep-me\n"), 0o600); err != nil {
		t.Fatalf("write env file: %v", err)
	}
	application := testApplication(t, config.Config{
		DataDir:        t.TempDir(),
		ActiveProvider: "mock",
		EnvFilePath:    envPath,
	})
	router := httpapi.NewRouter(application)

	response := requestJSON(t, router, http.MethodPatch, "/api/agent/active", map[string]any{"provider": "deepseek"})
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	content, err := os.ReadFile(envPath)
	if err != nil {
		t.Fatalf("read env file: %v", err)
	}
	if !strings.Contains(string(content), "AI_ACTIVE_PROVIDER=deepseek") || !strings.Contains(string(content), "DEEPSEEK_API_KEY=keep-me") {
		t.Fatalf("env file content = %s", string(content))
	}

	vendors := requestJSON(t, router, http.MethodGet, "/api/agent/vendors", nil)
	if vendors.Code != http.StatusOK || !strings.Contains(vendors.Body.String(), `"active":true`) {
		t.Fatalf("vendors after switch = %d, body = %s", vendors.Code, vendors.Body.String())
	}
}

func TestEnglishProcessWikiAndGroupsEndpoints(t *testing.T) {
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)
	now := time.Date(2026, 8, 3, 12, 0, 0, 0, time.UTC)
	for _, item := range []models.KnowledgeItem{
		{ID: "k-abandon", ItemType: "word_sense", Term: "abandon", ConciseDefinition: "放弃", CreatedAt: now, UpdatedAt: now},
		{ID: "k-abandoned", ItemType: "word_sense", Term: "abandoned", ConciseDefinition: "被抛弃的", CreatedAt: now, UpdatedAt: now},
	} {
		if err := application.Store.CreateKnowledgeItem(context.Background(), item); err != nil {
			t.Fatalf("create item: %v", err)
		}
	}

	process := requestJSON(t, router, http.MethodPost, "/api/english/process", map[string]any{})
	if process.Code != http.StatusOK {
		t.Fatalf("process status = %d, body = %s", process.Code, process.Body.String())
	}
	var processBody struct {
		Scanned         int `json:"scanned"`
		FamiliesCreated int `json:"families_created"`
		Groups          int `json:"groups"`
	}
	decodeJSON(t, process, &processBody)
	if processBody.Scanned != 2 || processBody.FamiliesCreated != 1 || processBody.Groups != 1 {
		t.Fatalf("process body = %#v", processBody)
	}

	groups := requestJSON(t, router, http.MethodGet, "/api/groups", nil)
	if groups.Code != http.StatusOK {
		t.Fatalf("groups status = %d", groups.Code)
	}
	var groupsBody struct {
		Items []models.KnowledgeGroup `json:"items"`
	}
	decodeJSON(t, groups, &groupsBody)
	if len(groupsBody.Items) != 1 || groupsBody.Items[0].Kind != "word_family" {
		t.Fatalf("groups = %#v", groupsBody.Items)
	}

	wiki := requestJSON(t, router, http.MethodPost, "/api/english/wiki", map[string]any{
		"item_ids": []string{"k-abandon", "k-abandoned"},
	})
	if wiki.Code != http.StatusOK {
		t.Fatalf("wiki status = %d, body = %s", wiki.Code, wiki.Body.String())
	}
	var wikiBody struct {
		Generated int `json:"generated"`
	}
	decodeJSON(t, wiki, &wikiBody)
	if wikiBody.Generated != 2 {
		t.Fatalf("wiki body = %#v", wikiBody)
	}

	filtered := requestJSON(t, router, http.MethodGet, "/api/knowledge?group="+groupsBody.Items[0].ID+"&limit=10", nil)
	if filtered.Code != http.StatusOK {
		t.Fatalf("filtered status = %d", filtered.Code)
	}
	var filteredBody struct {
		Items []json.RawMessage `json:"items"`
	}
	decodeJSON(t, filtered, &filteredBody)
	if len(filteredBody.Items) != 2 {
		t.Fatalf("filtered items = %d", len(filteredBody.Items))
	}
}

func TestAudioTimelineEndpointReadsSidecar(t *testing.T) {
	dataDir := t.TempDir()
	application := testApplication(t, config.Config{DataDir: dataDir})
	cacheDir := filepath.Join(dataDir, "audio-cache")
	if err := os.MkdirAll(cacheDir, 0o700); err != nil {
		t.Fatalf("create cache dir: %v", err)
	}
	request := audio.Request{Term: "abandon", Provider: "dashscope", Format: "wav"}
	key := audio.CacheKey(request)
	if err := os.WriteFile(filepath.Join(cacheDir, key+".wav"), []byte("dummy"), 0o600); err != nil {
		t.Fatalf("write audio: %v", err)
	}
	if err := os.WriteFile(filepath.Join(cacheDir, key+".wav.timeline.json"),
		[]byte(`{"segments":[{"start":0,"end":800,"text":"abandon"}]}`), 0o600); err != nil {
		t.Fatalf("write timeline: %v", err)
	}

	response := requestJSON(t, httpapi.NewRouter(application), http.MethodGet,
		"/api/audio/timeline?term=abandon&provider=dashscope&format=wav", nil)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	var body struct {
		Segments []audio.Segment `json:"segments"`
	}
	decodeJSON(t, response, &body)
	if len(body.Segments) != 1 || body.Segments[0].Text != "abandon" || body.Segments[0].End != 800 {
		t.Fatalf("timeline body = %#v", body.Segments)
	}
}

func TestAgentTestEndpointChecksActiveProvider(t *testing.T) {
	application := testApplication(t, config.Config{})
	response := requestJSON(t, httpapi.NewRouter(application), http.MethodPost, "/api/agent/test", map[string]any{"provider": "mock"})
	if response.Code != http.StatusOK {
		t.Fatalf("mock test status = %d, body = %s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `"ok":true`) {
		t.Fatalf("mock test body = %s", response.Body.String())
	}

	unimplemented := requestJSON(t, httpapi.NewRouter(application), http.MethodPost, "/api/agent/test", map[string]any{"provider": "qwen"})
	if unimplemented.Code != http.StatusBadRequest {
		t.Fatalf("unimplemented test status = %d, body = %s", unimplemented.Code, unimplemented.Body.String())
	}
}

func TestGenerateWordWikiThroughAgentEndpoint(t *testing.T) {
	application := testApplication(t, config.Config{})
	now := time.Date(2026, 8, 3, 12, 0, 0, 0, time.UTC)
	if err := application.Store.CreateKnowledgeItem(context.Background(), models.KnowledgeItem{
		ID: "k-abandon", ItemType: "word_sense", Term: "abandon", ConciseDefinition: "放弃", CreatedAt: now, UpdatedAt: now,
	}); err != nil {
		t.Fatalf("create item: %v", err)
	}
	response := requestJSON(t, httpapi.NewRouter(application), http.MethodPost, "/api/agent/generate", map[string]any{
		"kind":      "word_wiki",
		"word_wiki": map[string]any{"term": "abandon", "definition": "放弃"},
	})
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `"detailed_markdown"`) {
		t.Fatalf("response = %s", response.Body.String())
	}
}

func TestAgentConfigEndpointWritesKeyAndNeverEchoesIt(t *testing.T) {
	envPath := filepath.Join(t.TempDir(), ".env.local")
	if err := os.WriteFile(envPath, []byte("AI_ACTIVE_PROVIDER=mock\nDEEPSEEK_MODEL=old-model\n"), 0o600); err != nil {
		t.Fatalf("write env file: %v", err)
	}
	application := testApplication(t, config.Config{
		DataDir:        t.TempDir(),
		ActiveProvider: "mock",
		EnvFilePath:    envPath,
	})
	router := httpapi.NewRouter(application)

	response := requestJSON(t, router, http.MethodPatch, "/api/agent/config", map[string]any{
		"provider":        "deepseek",
		"api_key":         "sk-live-secret",
		"model":           "deepseek-v4-flash",
		"reasoning_model": "deepseek-v4-pro",
		"base_url":        "https://api.deepseek.com/v1",
	})
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if strings.Contains(response.Body.String(), "sk-live-secret") {
		t.Fatalf("config endpoint echoed the API key: %s", response.Body.String())
	}
	var saved struct {
		Provider       string `json:"provider"`
		KeyConfigured  bool   `json:"key_configured"`
		Model          string `json:"model"`
		ReasoningModel string `json:"reasoning_model"`
		BaseURL        string `json:"base_url"`
	}
	decodeJSON(t, response, &saved)
	if saved.Provider != "deepseek" || !saved.KeyConfigured || saved.Model != "deepseek-v4-flash" || saved.ReasoningModel != "deepseek-v4-pro" {
		t.Fatalf("saved config = %#v", saved)
	}

	content, err := os.ReadFile(envPath)
	if err != nil {
		t.Fatalf("read env file: %v", err)
	}
	if !strings.Contains(string(content), "DEEPSEEK_API_KEY=sk-live-secret") || !strings.Contains(string(content), "DEEPSEEK_MODEL=deepseek-v4-flash") {
		t.Fatalf("env file content = %s", string(content))
	}
	if application.Config.DeepSeek.APIKey != "sk-live-secret" || application.Config.DeepSeek.Model != "deepseek-v4-flash" {
		t.Fatalf("in-memory config not updated: %#v", application.Config.DeepSeek)
	}
	vendors := requestJSON(t, router, http.MethodGet, "/api/agent/vendors", nil)
	if !strings.Contains(vendors.Body.String(), `"key_configured":true`) {
		t.Fatalf("vendors did not reflect saved key: %s", vendors.Body.String())
	}
}

func TestAgentConfigEndpointClearsKey(t *testing.T) {
	envPath := filepath.Join(t.TempDir(), ".env.local")
	if err := os.WriteFile(envPath, []byte("AI_ACTIVE_PROVIDER=deepseek\nDEEPSEEK_API_KEY=sk-old\nDEEPSEEK_MODEL=flash\n"), 0o600); err != nil {
		t.Fatalf("write env file: %v", err)
	}
	application := testApplication(t, config.Config{
		DataDir:        t.TempDir(),
		ActiveProvider: "deepseek",
		DeepSeek: config.DeepSeekConfig{
			APIKey:  "sk-old",
			BaseURL: "https://api.deepseek.com/v1",
			Model:   "deepseek-v4-flash",
		},
		EnvFilePath: envPath,
	})
	router := httpapi.NewRouter(application)

	response := requestJSON(t, router, http.MethodPatch, "/api/agent/config", map[string]any{
		"provider": "deepseek",
		"api_key":  "",
	})
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	content, err := os.ReadFile(envPath)
	if err != nil {
		t.Fatalf("read env file: %v", err)
	}
	if strings.Contains(string(content), "DEEPSEEK_API_KEY") {
		t.Fatalf("cleared key still present:\n%s", string(content))
	}
	if application.Config.DeepSeek.APIKey != "" {
		t.Fatalf("in-memory key not cleared: %q", application.Config.DeepSeek.APIKey)
	}
}

func TestAgentConfigEndpointValidatesProviderAndFields(t *testing.T) {
	envPath := filepath.Join(t.TempDir(), ".env.local")
	if err := os.WriteFile(envPath, []byte(""), 0o600); err != nil {
		t.Fatalf("write env file: %v", err)
	}
	application := testApplication(t, config.Config{DataDir: t.TempDir(), EnvFilePath: envPath})
	router := httpapi.NewRouter(application)

	unknown := requestJSON(t, router, http.MethodPatch, "/api/agent/config", map[string]any{"provider": "qwen", "api_key": "x"})
	if unknown.Code != http.StatusBadRequest {
		t.Fatalf("unknown provider status = %d, body = %s", unknown.Code, unknown.Body.String())
	}
	hacked := requestJSON(t, router, http.MethodPatch, "/api/agent/config", map[string]any{"provider": "deepseek", "hacked_field": "x"})
	if hacked.Code != http.StatusBadRequest {
		t.Fatalf("unknown field status = %d, body = %s", hacked.Code, hacked.Body.String())
	}
}

func TestAgentConfigEndpointSupportsDashScopeTTS(t *testing.T) {
	envPath := filepath.Join(t.TempDir(), ".env.local")
	if err := os.WriteFile(envPath, []byte(""), 0o600); err != nil {
		t.Fatalf("write env file: %v", err)
	}
	application := testApplication(t, config.Config{DataDir: t.TempDir(), EnvFilePath: envPath})
	router := httpapi.NewRouter(application)

	response := requestJSON(t, router, http.MethodPatch, "/api/agent/config", map[string]any{
		"provider": "dashscope",
		"api_key":  "dashscope-secret",
		"voice":    "longhua",
	})
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if strings.Contains(response.Body.String(), "dashscope-secret") {
		t.Fatalf("config endpoint echoed the DashScope key: %s", response.Body.String())
	}
	content, err := os.ReadFile(envPath)
	if err != nil {
		t.Fatalf("read env file: %v", err)
	}
	if !strings.Contains(string(content), "DASHSCOPE_API_KEY=dashscope-secret") || !strings.Contains(string(content), "DASHSCOPE_TTS_VOICE=longhua") {
		t.Fatalf("env file content = %s", string(content))
	}
	if application.Config.DashScopeAPIKey != "dashscope-secret" || application.Config.DashScopeVoice != "longhua" {
		t.Fatalf("in-memory dashscope config not updated: %#v", application.Config)
	}
}

var _ = httptest.NewRecorder
