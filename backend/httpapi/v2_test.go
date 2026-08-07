package httpapi_test

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
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
		AI: map[string]config.VendorConfig{
			"deepseek": {
				APIKey:  "sk-test-secret",
				BaseURL: "https://api.deepseek.com/v1",
				Model:   "deepseek-v4-flash",
			},
			"claude": {APIKey: "sk-ant-test-secret"},
		},
	})
	response := requestJSON(t, httpapi.NewRouter(application), http.MethodGet, "/api/agent/vendors", nil)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	body := response.Body.String()
	for _, secret := range []string{"sk-test-secret", "sk-ant-test-secret"} {
		if strings.Contains(body, secret) {
			t.Fatalf("vendor list leaked the API key: %s", body)
		}
	}
	if !strings.Contains(body, `"id":"deepseek"`) || !strings.Contains(body, `"implemented":true`) || !strings.Contains(body, `"key_configured":true`) || !strings.Contains(body, `"active":true`) {
		t.Fatalf("deepseek vendor status missing: %s", body)
	}
	// Every registered vendor must reach the settings UI, and the ones without a
	// key must still describe themselves so they can be configured there.
	for _, spec := range config.VendorSpecs() {
		if !strings.Contains(body, `"id":"`+spec.ID+`"`) {
			t.Fatalf("vendor %q missing from the list: %s", spec.ID, body)
		}
	}
	if !strings.Contains(body, `"id":"claude"`) || !strings.Contains(body, `"claude-sonnet-4-6"`) {
		t.Fatalf("claude vendor status missing: %s", body)
	}
	if strings.Contains(body, `"implemented":false`) {
		t.Fatalf("no vendor should be unimplemented: %s", body)
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
	if stored := application.Config.Vendor("deepseek"); stored.APIKey != "sk-live-secret" || stored.Model != "deepseek-v4-flash" {
		t.Fatalf("in-memory config not updated: %#v", stored)
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
		AI: map[string]config.VendorConfig{
			"deepseek": {
				APIKey:  "sk-old",
				BaseURL: "https://api.deepseek.com/v1",
				Model:   "deepseek-v4-flash",
			},
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
	if cleared := application.Config.Vendor("deepseek"); cleared.APIKey != "" {
		t.Fatalf("in-memory key not cleared: %q", cleared.APIKey)
	}
}

func TestAgentConfigEndpointValidatesProviderAndFields(t *testing.T) {
	envPath := filepath.Join(t.TempDir(), ".env.local")
	if err := os.WriteFile(envPath, []byte(""), 0o600); err != nil {
		t.Fatalf("write env file: %v", err)
	}
	application := testApplication(t, config.Config{DataDir: t.TempDir(), EnvFilePath: envPath})
	router := httpapi.NewRouter(application)

	unknown := requestJSON(t, router, http.MethodPatch, "/api/agent/config", map[string]any{"provider": "not-a-vendor", "api_key": "x"})
	if unknown.Code != http.StatusBadRequest {
		t.Fatalf("unknown provider status = %d, body = %s", unknown.Code, unknown.Body.String())
	}
	// mock has no credentials to store, so it is the one registered vendor that
	// must still be refused here.
	offline := requestJSON(t, router, http.MethodPatch, "/api/agent/config", map[string]any{"provider": "mock", "api_key": "x"})
	if offline.Code != http.StatusBadRequest {
		t.Fatalf("mock provider status = %d, body = %s", offline.Code, offline.Body.String())
	}
	hacked := requestJSON(t, router, http.MethodPatch, "/api/agent/config", map[string]any{"provider": "deepseek", "hacked_field": "x"})
	if hacked.Code != http.StatusBadRequest {
		t.Fatalf("unknown field status = %d, body = %s", hacked.Code, hacked.Body.String())
	}
	empty := requestJSON(t, router, http.MethodPatch, "/api/agent/config", map[string]any{"provider": "deepseek"})
	if empty.Code != http.StatusBadRequest {
		t.Fatalf("empty update status = %d, body = %s", empty.Code, empty.Body.String())
	}
}

// Every key-bearing vendor must accept a credential write, otherwise it would be
// listed in the settings UI but impossible to configure there.
func TestAgentConfigEndpointAcceptsEveryKeyBearingVendor(t *testing.T) {
	for _, spec := range config.VendorSpecs() {
		if !spec.NeedsKey() {
			continue
		}
		t.Run(spec.ID, func(t *testing.T) {
			envPath := filepath.Join(t.TempDir(), ".env.local")
			if err := os.WriteFile(envPath, []byte(""), 0o600); err != nil {
				t.Fatalf("write env file: %v", err)
			}
			application := testApplication(t, config.Config{DataDir: t.TempDir(), EnvFilePath: envPath})
			router := httpapi.NewRouter(application)

			response := requestJSON(t, router, http.MethodPatch, "/api/agent/config", map[string]any{
				"provider": spec.ID,
				"api_key":  "sk-" + spec.ID,
			})
			if response.Code != http.StatusOK {
				t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
			}
			if strings.Contains(response.Body.String(), "sk-"+spec.ID) {
				t.Fatalf("config response leaked the key: %s", response.Body.String())
			}
			content, err := os.ReadFile(envPath)
			if err != nil {
				t.Fatalf("read env file: %v", err)
			}
			if !strings.Contains(string(content), spec.EnvKeys()["api_key"]+"=sk-"+spec.ID) {
				t.Fatalf("env file missing the vendor key:\n%s", string(content))
			}
			if stored := application.Config.Vendor(spec.ID); stored.APIKey != "sk-"+spec.ID {
				t.Fatalf("in-memory config not updated: %#v", stored)
			}
		})
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

func TestKnowledgeListFiltersBySubject(t *testing.T) {
	application := testApplication(t, config.Config{})
	now := time.Date(2026, 8, 3, 12, 0, 0, 0, time.UTC)
	for _, item := range []models.KnowledgeItem{
		{ID: "k-en", ItemType: "word_sense", Term: "abandon", ConciseDefinition: "放弃", Subject: "english", CreatedAt: now, UpdatedAt: now},
		{ID: "k-math", ItemType: "word_sense", Term: "derivative", ConciseDefinition: "导数", Subject: "math", CreatedAt: now, UpdatedAt: now},
	} {
		if err := application.Store.CreateKnowledgeItem(context.Background(), item); err != nil {
			t.Fatalf("create item: %v", err)
		}
	}
	response := requestJSON(t, httpapi.NewRouter(application), http.MethodGet, "/api/knowledge?subject=english&limit=10", nil)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	var body struct {
		Items []struct {
			ID      string `json:"id"`
			Subject string `json:"subject"`
		} `json:"items"`
	}
	decodeJSON(t, response, &body)
	if len(body.Items) != 1 || body.Items[0].ID != "k-en" || body.Items[0].Subject != "english" {
		t.Fatalf("filtered items = %#v", body.Items)
	}
}

func TestDueReviewsFilterBySubject(t *testing.T) {
	application := testApplication(t, config.Config{})
	ctx := context.Background()
	now := time.Date(2026, 8, 3, 12, 0, 0, 0, time.UTC)
	for index, item := range []models.KnowledgeItem{
		{ID: "k-en", ItemType: "word_sense", Term: "abandon", ConciseDefinition: "放弃", Subject: "english", CreatedAt: now, UpdatedAt: now},
		{ID: "k-math", ItemType: "word_sense", Term: "derivative", ConciseDefinition: "导数", Subject: "math", CreatedAt: now, UpdatedAt: now},
	} {
		if err := application.Store.CreateKnowledgeItem(ctx, item); err != nil {
			t.Fatalf("create item: %v", err)
		}
		prompt := models.Prompt{
			ID:              "prompt-" + item.ID,
			KnowledgeItemID: item.ID,
			PromptType:      "en_to_zh",
			Question:        item.Term,
			AcceptedAnswers: []string{item.ConciseDefinition},
			CreatedAt:       now.Add(time.Duration(index) * time.Second),
			UpdatedAt:       now.Add(time.Duration(index) * time.Second),
		}
		if err := application.Store.CreatePrompt(ctx, prompt); err != nil {
			t.Fatalf("create prompt: %v", err)
		}
		if err := application.Store.UpsertReviewState(ctx, models.ReviewState{
			PromptID:  prompt.ID,
			CardJSON:  json.RawMessage(`{"due":"2026-08-03T12:00:00Z"}`),
			DueAt:     now,
			UpdatedAt: now,
		}); err != nil {
			t.Fatalf("upsert state: %v", err)
		}
	}
	response := requestJSON(t, httpapi.NewRouter(application), http.MethodGet, "/api/reviews/due?subject=math&limit=10", nil)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	var body struct {
		Items []struct {
			Prompt struct {
				ID string `json:"id"`
			} `json:"prompt"`
		} `json:"items"`
	}
	decodeJSON(t, response, &body)
	if len(body.Items) != 1 || body.Items[0].Prompt.ID != "prompt-k-math" {
		t.Fatalf("due items = %#v", body.Items)
	}
}

func TestLauncherServesSPAUpdateStatusAndClose(t *testing.T) {
	staticDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(staticDir, "index.html"), []byte("<html>学习系统首页</html>"), 0o600); err != nil {
		t.Fatalf("write index: %v", err)
	}
	application := testApplication(t, config.Config{
		DataDir:    t.TempDir(),
		Launcher:   true,
		StaticDir:  staticDir,
		UpdateRepo: "fake/study-os",
	})
	if application.Launcher == nil {
		t.Fatal("launcher service missing")
	}
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/repos/fake/study-os/releases/latest" {
			_, _ = response.Write([]byte(`{"tag_name":"v0.3.0","body":"更新说明","assets":[{"name":"study-os-pwa-windows-x64.zip","browser_download_url":"/download"}]}`))
			return
		}
		http.NotFound(response, request)
	}))
	defer server.Close()
	application.Launcher.HTTPClient = server.Client()
	application.Launcher.DownloadBase = server.URL
	application.Launcher.APIBase = server.URL
	router := httpapi.NewRouter(application)

	status := requestJSON(t, router, http.MethodGet, "/api/update/status", nil)
	if status.Code != http.StatusOK || !strings.Contains(status.Body.String(), `"update_available":true`) {
		t.Fatalf("update status = %d, body = %s", status.Code, status.Body.String())
	}
	spa := requestJSON(t, router, http.MethodGet, "/knowledge", nil)
	if spa.Code != http.StatusOK || !strings.Contains(spa.Body.String(), "学习系统首页") {
		t.Fatalf("spa fallback = %d, body = %s", spa.Code, spa.Body.String())
	}
	closed := false
	application.Launcher.OnShutdown = func() { closed = true }
	closeResponse := requestJSON(t, router, http.MethodPost, "/api/launcher/close", nil)
	if closeResponse.Code != http.StatusOK {
		t.Fatalf("close = %d, body = %s", closeResponse.Code, closeResponse.Body.String())
	}
	deadline := time.Now().Add(2 * time.Second)
	for !closed && time.Now().Before(deadline) {
		time.Sleep(20 * time.Millisecond)
	}
	if !closed {
		t.Fatal("launcher close callback was not invoked")
	}
}

func TestChatAsyncFlowAnswersInBackground(t *testing.T) {
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)

	sent := requestJSON(t, router, http.MethodPost, "/api/chat", map[string]any{
		"subject": "math",
		"message": "导数是什么？",
	})
	if sent.Code != http.StatusAccepted {
		t.Fatalf("send status = %d, body = %s", sent.Code, sent.Body.String())
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		messages := requestJSON(t, router, http.MethodGet, "/api/chat/messages?subject=math&limit=10", nil)
		var body struct {
			Items []models.ChatMessage `json:"items"`
		}
		decodeJSON(t, messages, &body)
		if len(body.Items) == 2 && body.Items[1].Status == "done" && body.Items[1].Content != "" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("chat answer did not complete: %#v", body.Items)
		}
		time.Sleep(50 * time.Millisecond)
	}
}

func TestCompareEndpointProducesStructuredOutput(t *testing.T) {
	application := testApplication(t, config.Config{})
	response := requestJSON(t, httpapi.NewRouter(application), http.MethodPost, "/api/compare", map[string]any{
		"subject": "physics",
		"term_a":  "速度",
		"term_b":  "加速度",
	})
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "summary") || !strings.Contains(response.Body.String(), "速度") {
		t.Fatalf("compare body = %s", response.Body.String())
	}
}

func TestDumpEndpointStoresBrainDump(t *testing.T) {
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)
	response := requestJSON(t, router, http.MethodPost, "/api/dump", map[string]any{
		"text": "等下记得查一下动能定理的适用条件",
	})
	if response.Code != http.StatusCreated {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	items := requestJSON(t, router, http.MethodGet, "/api/knowledge?tag=brain_dump&limit=10", nil)
	if items.Code != http.StatusOK || !strings.Contains(items.Body.String(), "brain_dump") {
		t.Fatalf("knowledge = %d, body = %s", items.Code, items.Body.String())
	}
}

func TestKnowledgeTagEndpointAddsAndFilters(t *testing.T) {
	application := testApplication(t, config.Config{})
	ctx := context.Background()
	now := time.Date(2026, 8, 3, 12, 0, 0, 0, time.UTC)
	if err := application.Store.CreateKnowledgeItem(ctx, models.KnowledgeItem{
		ID: "k-tag", ItemType: "theorem", Term: "动能定理", ConciseDefinition: "合外力做功等于动能变化",
		Subject: "physics", CreatedAt: now, UpdatedAt: now,
	}); err != nil {
		t.Fatalf("create item: %v", err)
	}
	router := httpapi.NewRouter(application)
	added := requestJSON(t, router, http.MethodPost, "/api/knowledge/k-tag/tag", map[string]any{"tag": "二级结论"})
	if added.Code != http.StatusOK || !strings.Contains(added.Body.String(), "二级结论") {
		t.Fatalf("tag add = %d, body = %s", added.Code, added.Body.String())
	}
	filtered := requestJSON(t, router, http.MethodGet, "/api/knowledge?tag=二级结论&limit=10", nil)
	if filtered.Code != http.StatusOK || !strings.Contains(filtered.Body.String(), "k-tag") {
		t.Fatalf("tag filter = %d, body = %s", filtered.Code, filtered.Body.String())
	}
}

func TestDueReviewsRecoveryModeFiltersEasyPrompts(t *testing.T) {
	application := testApplication(t, config.Config{})
	ctx := context.Background()
	now := time.Date(2026, 8, 3, 12, 0, 0, 0, time.UTC)
	if err := application.Store.CreateKnowledgeItem(ctx, models.KnowledgeItem{
		ID: "k-r", ItemType: "word_sense", Term: "abandon", ConciseDefinition: "放弃", Subject: "english", CreatedAt: now, UpdatedAt: now,
	}); err != nil {
		t.Fatalf("create item: %v", err)
	}
	for index, prompt := range []models.Prompt{
		{ID: "p-en", KnowledgeItemID: "k-r", PromptType: "en_to_zh", Question: "abandon", CreatedAt: now, UpdatedAt: now},
		{ID: "p-sentence", KnowledgeItemID: "k-r", PromptType: "make_sentence", Question: "用 abandon 造句", CreatedAt: now.Add(time.Second), UpdatedAt: now.Add(time.Second)},
	} {
		if err := application.Store.CreatePrompt(ctx, prompt); err != nil {
			t.Fatalf("create prompt: %v", err)
		}
		if err := application.Store.UpsertReviewState(ctx, models.ReviewState{
			PromptID: prompt.ID, CardJSON: json.RawMessage(`{"due":"x"}`), DueAt: now.Add(time.Duration(index) * time.Second), UpdatedAt: now,
		}); err != nil {
			t.Fatalf("upsert state: %v", err)
		}
	}
	response := requestJSON(t, httpapi.NewRouter(application), http.MethodGet, "/api/reviews/due?mode=recovery&limit=10", nil)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d", response.Code)
	}
	var body struct {
		Items []struct {
			Prompt struct {
				ID string `json:"id"`
			} `json:"prompt"`
		} `json:"items"`
	}
	decodeJSON(t, response, &body)
	if len(body.Items) != 1 || body.Items[0].Prompt.ID != "p-en" {
		t.Fatalf("recovery items = %#v", body.Items)
	}
}

func TestUpdateStatusWorksInNormalMode(t *testing.T) {
	application := testApplication(t, config.Config{})
	response := requestJSON(t, httpapi.NewRouter(application), http.MethodGet, "/api/update/status", nil)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `"update_available":false`) {
		t.Fatalf("body = %s", response.Body.String())
	}
}

func TestDashboardIncludesSubjectDueCountsAndRecentItems(t *testing.T) {
	application := testApplication(t, config.Config{})
	ctx := context.Background()
	now := time.Date(2026, 8, 3, 12, 0, 0, 0, time.UTC)
	if err := application.Store.CreateKnowledgeItem(ctx, models.KnowledgeItem{
		ID: "k-dash", ItemType: "word_sense", Term: "abandon", ConciseDefinition: "放弃",
		Subject: "english", CreatedAt: now, UpdatedAt: now,
	}); err != nil {
		t.Fatalf("create item: %v", err)
	}
	prompt := models.Prompt{
		ID: "p-dash", KnowledgeItemID: "k-dash", PromptType: "en_to_zh",
		Question: "abandon", AcceptedAnswers: []string{"放弃"}, CreatedAt: now, UpdatedAt: now,
	}
	if err := application.Store.CreatePrompt(ctx, prompt); err != nil {
		t.Fatalf("create prompt: %v", err)
	}
	if err := application.Store.UpsertReviewState(ctx, models.ReviewState{
		PromptID: prompt.ID, CardJSON: json.RawMessage(`{"due":"x"}`), DueAt: now, UpdatedAt: now,
	}); err != nil {
		t.Fatalf("upsert state: %v", err)
	}
	response := requestJSON(t, httpapi.NewRouter(application), http.MethodGet, "/api/dashboard", nil)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	var body struct {
		SubjectsDue map[string]int `json:"subjects_due"`
		RecentItems []struct {
			ID string `json:"id"`
		} `json:"recent_items"`
	}
	decodeJSON(t, response, &body)
	if body.SubjectsDue["english"] != 1 {
		t.Fatalf("subjects_due = %#v", body.SubjectsDue)
	}
	if len(body.RecentItems) != 1 || body.RecentItems[0].ID != "k-dash" {
		t.Fatalf("recent_items = %#v", body.RecentItems)
	}
}

func TestIntegrateEndpointCreatesListsAndGetsNotes(t *testing.T) {
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)

	created := requestJSON(t, router, http.MethodPost, "/api/integrate", map[string]any{
		"subject": "physics",
		"title":   "运动学",
		"text":    "速度描述快慢。加速度描述变化快慢。",
	})
	if created.Code != http.StatusCreated {
		t.Fatalf("create status = %d, body = %s", created.Code, created.Body.String())
	}
	var note models.IntegratedNote
	decodeJSON(t, created, &note)
	if note.Title != "运动学" || !strings.Contains(string(note.MindmapJSON), `"root"`) || !strings.Contains(string(note.CardsJSON), `"concept"`) {
		t.Fatalf("note = %#v", note)
	}

	list := requestJSON(t, router, http.MethodGet, "/api/integrate?subject=physics&limit=10", nil)
	if list.Code != http.StatusOK || !strings.Contains(list.Body.String(), "note-") {
		t.Fatalf("list = %d, body = %s", list.Code, list.Body.String())
	}
	get := requestJSON(t, router, http.MethodGet, "/api/integrate/"+note.ID, nil)
	if get.Code != http.StatusOK || !strings.Contains(get.Body.String(), "运动学") {
		t.Fatalf("get = %d, body = %s", get.Code, get.Body.String())
	}
}

func TestIntegrateEndpointAcceptsKnowledgeItemSource(t *testing.T) {
	application := testApplication(t, config.Config{})
	ctx := context.Background()
	now := time.Date(2026, 8, 3, 12, 0, 0, 0, time.UTC)
	if err := application.Store.CreateKnowledgeItem(ctx, models.KnowledgeItem{
		ID: "k-int", ItemType: "concept", Term: "加速度", ConciseDefinition: "速度变化快慢",
		Subject: "physics", CreatedAt: now, UpdatedAt: now,
	}); err != nil {
		t.Fatalf("create item: %v", err)
	}
	response := requestJSON(t, httpapi.NewRouter(application), http.MethodPost, "/api/integrate", map[string]any{
		"knowledge_id": "k-int",
	})
	if response.Code != http.StatusCreated {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `"source_id":"k-int"`) {
		t.Fatalf("body = %s", response.Body.String())
	}
}

func TestChatAttachmentsAndConversations(t *testing.T) {
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)

	upload := attachmentMultipartRequest(t, router, "hello attachment file", "notes.txt")
	if upload.Code != http.StatusCreated {
		t.Fatalf("upload status = %d, body = %s", upload.Code, upload.Body.String())
	}
	var uploaded struct {
		ID   string `json:"id"`
		Kind string `json:"kind"`
	}
	decodeJSON(t, upload, &uploaded)
	if uploaded.ID == "" || uploaded.Kind != "text" {
		t.Fatalf("uploaded = %#v", uploaded)
	}

	sent := requestJSON(t, router, http.MethodPost, "/api/chat", map[string]any{
		"subject":        "math",
		"message":        "帮我看看这个文件",
		"attachment_ids": []string{uploaded.ID},
	})
	if sent.Code != http.StatusAccepted {
		t.Fatalf("send status = %d, body = %s", sent.Code, sent.Body.String())
	}
	var sentBody struct {
		SessionID string `json:"session_id"`
	}
	decodeJSON(t, sent, &sentBody)
	if sentBody.SessionID == "" {
		t.Fatal("session_id missing")
	}

	deadline := time.Now().Add(5 * time.Second)
	for {
		messages := requestJSON(t, router, http.MethodGet,
			"/api/chat/messages?subject=math&session_id="+sentBody.SessionID+"&limit=10", nil)
		var body struct {
			Items []models.ChatMessage `json:"items"`
		}
		decodeJSON(t, messages, &body)
		if len(body.Items) == 2 && body.Items[1].Status == "done" {
			var userMessage string
			for _, item := range body.Items {
				if item.Role == "user" {
					userMessage = item.Content
				}
			}
			if !strings.Contains(userMessage, "hello attachment file") {
				t.Fatalf("attachment text missing from user message: %q", userMessage)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("chat did not complete: %#v", body.Items)
		}
		time.Sleep(50 * time.Millisecond)
	}

	conversations := requestJSON(t, router, http.MethodGet, "/api/chat/conversations?subject=math&limit=10", nil)
	if conversations.Code != http.StatusOK || !strings.Contains(conversations.Body.String(), sentBody.SessionID) {
		t.Fatalf("conversations = %d, body = %s", conversations.Code, conversations.Body.String())
	}
	if !strings.Contains(conversations.Body.String(), "帮我看看这个文件") {
		t.Fatalf("conversation title missing: %s", conversations.Body.String())
	}

	download := requestJSON(t, router, http.MethodGet, "/api/chat/attachments/"+uploaded.ID, nil)
	if download.Code != http.StatusOK || !strings.Contains(download.Body.String(), "hello attachment file") {
		t.Fatalf("attachment download = %d, body = %s", download.Code, download.Body.String())
	}
}

func attachmentMultipartRequest(t *testing.T, handler http.Handler, content, filename string) *httptest.ResponseRecorder {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", filename)
	if err != nil {
		t.Fatalf("create multipart file: %v", err)
	}
	if _, err := part.Write([]byte(content)); err != nil {
		t.Fatalf("write multipart file: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close multipart writer: %v", err)
	}
	request := httptest.NewRequest(http.MethodPost, "http://127.0.0.1/api/chat/attachments", &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

var _ = httptest.NewRecorder
