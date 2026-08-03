package config_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"study-os/backend/config"
)

func TestFromLookupParsesVendorSettings(t *testing.T) {
	values := map[string]string{
		"AI_ACTIVE_PROVIDER":       "deepseek",
		"DEEPSEEK_API_KEY":         "sk-test",
		"DEEPSEEK_BASE_URL":        "https://deepseek.example/v1",
		"DEEPSEEK_MODEL":           "deepseek-v4-flash",
		"DEEPSEEK_REASONING_MODEL": "deepseek-v4-pro",
	}
	cfg, err := config.FromLookup(func(key string) (string, bool) {
		value, ok := values[key]
		return value, ok
	})
	if err != nil {
		t.Fatalf("load vendor settings: %v", err)
	}
	if cfg.ActiveProvider != "deepseek" {
		t.Fatalf("active provider = %q", cfg.ActiveProvider)
	}
	if cfg.DeepSeek.APIKey != "sk-test" {
		t.Fatalf("api key = %q", cfg.DeepSeek.APIKey)
	}
	if cfg.DeepSeek.BaseURL != "https://deepseek.example/v1" {
		t.Fatalf("base url = %q", cfg.DeepSeek.BaseURL)
	}
	if cfg.DeepSeek.Model != "deepseek-v4-flash" {
		t.Fatalf("model = %q", cfg.DeepSeek.Model)
	}
	if cfg.DeepSeek.ReasoningModel != "deepseek-v4-pro" {
		t.Fatalf("reasoning model = %q", cfg.DeepSeek.ReasoningModel)
	}
}

func TestFromLookupAppliesDeepSeekDefaults(t *testing.T) {
	cfg, err := config.FromLookup(func(string) (string, bool) { return "", false })
	if err != nil {
		t.Fatalf("load defaults: %v", err)
	}
	if cfg.ActiveProvider != "mock" {
		t.Fatalf("active provider = %q", cfg.ActiveProvider)
	}
	if cfg.DeepSeek.BaseURL != "https://api.deepseek.com/v1" {
		t.Fatalf("default base url = %q", cfg.DeepSeek.BaseURL)
	}
	if cfg.DeepSeek.Model != "deepseek-v4-flash" {
		t.Fatalf("default model = %q", cfg.DeepSeek.Model)
	}
	if cfg.DeepSeek.ReasoningModel != "deepseek-v4-pro" {
		t.Fatalf("default reasoning model = %q", cfg.DeepSeek.ReasoningModel)
	}
}

func TestLoadFromFileGivesProcessEnvironmentPrecedence(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".env.local")
	contents := "AI_ACTIVE_PROVIDER=deepseek\nDEEPSEEK_API_KEY=from-file\nDEEPSEEK_MODEL=from-file-model\n"
	if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
		t.Fatalf("write env file: %v", err)
	}
	cfg, err := config.LoadFromFile(path, func(key string) (string, bool) {
		if key == "DEEPSEEK_API_KEY" {
			return "from-process", true
		}
		return "", false
	})
	if err != nil {
		t.Fatalf("load env file: %v", err)
	}
	if cfg.DeepSeek.APIKey != "from-process" {
		t.Fatalf("key priority = %q", cfg.DeepSeek.APIKey)
	}
	if cfg.DeepSeek.Model != "from-file-model" {
		t.Fatalf("model = %q", cfg.DeepSeek.Model)
	}
	if cfg.EnvFilePath != path {
		t.Fatalf("env file path = %q", cfg.EnvFilePath)
	}
}

func TestVendorsListsImplementedAndPlaceholders(t *testing.T) {
	values := map[string]string{
		"AI_ACTIVE_PROVIDER": "deepseek",
		"DEEPSEEK_API_KEY":   "sk-test",
	}
	cfg, err := config.FromLookup(func(key string) (string, bool) {
		value, ok := values[key]
		return value, ok
	})
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	vendors := cfg.Vendors()
	if len(vendors) < 6 {
		t.Fatalf("vendor count = %d, want at least 6", len(vendors))
	}
	byID := make(map[string]config.VendorStatus, len(vendors))
	for _, vendor := range vendors {
		byID[vendor.ID] = vendor
	}
	mock := byID["mock"]
	if !mock.Implemented || mock.Active {
		t.Fatalf("mock vendor = %#v", mock)
	}
	deepseek := byID["deepseek"]
	if !deepseek.Implemented || !deepseek.KeyConfigured || !deepseek.Active {
		t.Fatalf("deepseek vendor = %#v", deepseek)
	}
	if deepseek.BaseURL != "https://api.deepseek.com/v1" {
		t.Fatalf("deepseek base url = %q", deepseek.BaseURL)
	}
	if len(deepseek.Models) != 2 || deepseek.Models[0] != "deepseek-v4-flash" || deepseek.Models[1] != "deepseek-v4-pro" {
		t.Fatalf("deepseek models = %#v", deepseek.Models)
	}
	for _, placeholder := range []string{"qwen", "glm", "openai", "volcengine"} {
		if byID[placeholder].Implemented {
			t.Fatalf("vendor %q must not be implemented yet", placeholder)
		}
	}
}

func TestSetActiveProviderReplacesLineAndPreservesFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".env.local")
	contents := "# keep this comment\nAI_ACTIVE_PROVIDER=mock\nDEEPSEEK_API_KEY=keep-me\n"
	if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
		t.Fatalf("write env file: %v", err)
	}
	if err := config.SetActiveProvider(path, "deepseek"); err != nil {
		t.Fatalf("set active provider: %v", err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read env file: %v", err)
	}
	text := string(got)
	if !strings.Contains(text, "AI_ACTIVE_PROVIDER=deepseek") {
		t.Fatalf("active provider not updated:\n%s", text)
	}
	if strings.Contains(text, "AI_ACTIVE_PROVIDER=mock") {
		t.Fatalf("old provider still present:\n%s", text)
	}
	if !strings.Contains(text, "# keep this comment") || !strings.Contains(text, "DEEPSEEK_API_KEY=keep-me") {
		t.Fatalf("unrelated lines changed:\n%s", text)
	}
	backup, err := os.ReadFile(path + ".bak")
	if err != nil {
		t.Fatalf("read backup: %v", err)
	}
	if !strings.Contains(string(backup), "AI_ACTIVE_PROVIDER=mock") {
		t.Fatalf("backup does not contain original provider:\n%s", string(backup))
	}
}

func TestSetActiveProviderHandlesExportPrefix(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".env.local")
	if err := os.WriteFile(path, []byte("export AI_ACTIVE_PROVIDER=mock\n"), 0o600); err != nil {
		t.Fatalf("write env file: %v", err)
	}
	if err := config.SetActiveProvider(path, "deepseek"); err != nil {
		t.Fatalf("set active provider: %v", err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read env file: %v", err)
	}
	if !strings.Contains(string(got), "AI_ACTIVE_PROVIDER=deepseek") {
		t.Fatalf("export line not replaced:\n%s", string(got))
	}
}

func TestSetActiveProviderAppendsWhenMissing(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".env.local")
	if err := os.WriteFile(path, []byte("DEEPSEEK_API_KEY=abc\n"), 0o600); err != nil {
		t.Fatalf("write env file: %v", err)
	}
	if err := config.SetActiveProvider(path, "deepseek"); err != nil {
		t.Fatalf("set active provider: %v", err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read env file: %v", err)
	}
	text := string(got)
	if !strings.HasSuffix(text, "\nAI_ACTIVE_PROVIDER=deepseek\n") {
		t.Fatalf("active provider not appended cleanly:\n%s", text)
	}
}

func TestSetActiveProviderRejectsUnknownVendor(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".env.local")
	if err := os.WriteFile(path, []byte(""), 0o600); err != nil {
		t.Fatalf("write env file: %v", err)
	}
	if err := config.SetActiveProvider(path, "not-a-vendor"); err == nil {
		t.Fatal("expected an error for an unknown vendor")
	}
}

func TestFromLookupParsesDashScopeTTSSettings(t *testing.T) {
	values := map[string]string{
		"DASHSCOPE_API_KEY":   "dashscope-test-key",
		"DASHSCOPE_TTS_VOICE": "longhua",
	}
	cfg, err := config.FromLookup(func(key string) (string, bool) {
		value, ok := values[key]
		return value, ok
	})
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if cfg.DashScopeAPIKey != "dashscope-test-key" {
		t.Fatalf("dashscope key = %q", cfg.DashScopeAPIKey)
	}
	if cfg.DashScopeVoice != "longhua" {
		t.Fatalf("dashscope voice = %q", cfg.DashScopeVoice)
	}
}

func TestFromLookupAppliesDashScopeVoiceDefault(t *testing.T) {
	cfg, err := config.FromLookup(func(string) (string, bool) { return "", false })
	if err != nil {
		t.Fatalf("load defaults: %v", err)
	}
	if cfg.DashScopeVoice != "longxiaochun" {
		t.Fatalf("default voice = %q", cfg.DashScopeVoice)
	}
}
