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
	vendor := cfg.Vendor("deepseek")
	if vendor.APIKey != "sk-test" {
		t.Fatalf("api key = %q", vendor.APIKey)
	}
	if vendor.BaseURL != "https://deepseek.example/v1" {
		t.Fatalf("base url = %q", vendor.BaseURL)
	}
	if vendor.Model != "deepseek-v4-flash" {
		t.Fatalf("model = %q", vendor.Model)
	}
	if vendor.ReasoningModel != "deepseek-v4-pro" {
		t.Fatalf("reasoning model = %q", vendor.ReasoningModel)
	}
}

// Every registered vendor must resolve to a usable base URL and model without
// any environment at all, otherwise picking it in the settings UI would produce
// a provider that fails on first use.
func TestFromLookupAppliesDefaultsForEveryVendor(t *testing.T) {
	cfg, err := config.FromLookup(func(string) (string, bool) { return "", false })
	if err != nil {
		t.Fatalf("load defaults: %v", err)
	}
	if cfg.ActiveProvider != "mock" {
		t.Fatalf("active provider = %q", cfg.ActiveProvider)
	}
	for _, spec := range config.VendorSpecs() {
		if !spec.NeedsKey() {
			continue
		}
		vendor := cfg.Vendor(spec.ID)
		if vendor.APIKey != "" {
			t.Fatalf("vendor %q invented an api key: %q", spec.ID, vendor.APIKey)
		}
		if vendor.BaseURL == "" || vendor.Model == "" || vendor.ReasoningModel == "" {
			t.Fatalf("vendor %q has incomplete defaults: %#v", spec.ID, vendor)
		}
		if !strings.HasPrefix(vendor.BaseURL, "https://") {
			t.Fatalf("vendor %q base url must be https: %q", spec.ID, vendor.BaseURL)
		}
	}
	if got := cfg.Vendor("deepseek"); got.BaseURL != "https://api.deepseek.com/v1" || got.Model != "deepseek-v4-flash" {
		t.Fatalf("deepseek defaults = %#v", got)
	}
	if got := cfg.Vendor("claude"); got.Model != "claude-sonnet-4-6" || got.ReasoningModel != "claude-opus-4-6" {
		t.Fatalf("claude defaults = %#v", got)
	}
}

// Each vendor's env keys must be unique to it. A duplicated EnvPrefix would
// make two vendors silently share one API key.
func TestVendorEnvKeysAreUnique(t *testing.T) {
	owner := make(map[string]string)
	for _, spec := range config.VendorSpecs() {
		for _, key := range spec.EnvKeys() {
			if previous, taken := owner[key]; taken {
				t.Fatalf("env key %q claimed by both %q and %q", key, previous, spec.ID)
			}
			owner[key] = spec.ID
		}
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
	vendor := cfg.Vendor("deepseek")
	if vendor.APIKey != "from-process" {
		t.Fatalf("key priority = %q", vendor.APIKey)
	}
	if vendor.Model != "from-file-model" {
		t.Fatalf("model = %q", vendor.Model)
	}
	if cfg.EnvFilePath != path {
		t.Fatalf("env file path = %q", cfg.EnvFilePath)
	}
}

// Every registered vendor is now backed by a real wire protocol, so the list the
// settings UI renders must report all of them as usable and must never mark two
// vendors active at once.
func TestVendorsListsEveryRegisteredVendor(t *testing.T) {
	values := map[string]string{
		"AI_ACTIVE_PROVIDER": "deepseek",
		"DEEPSEEK_API_KEY":   "sk-test",
		"ANTHROPIC_API_KEY":  "sk-ant-test",
	}
	cfg, err := config.FromLookup(func(key string) (string, bool) {
		value, ok := values[key]
		return value, ok
	})
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	vendors := cfg.Vendors()
	if len(vendors) != len(config.VendorSpecs()) {
		t.Fatalf("vendor count = %d, want %d", len(vendors), len(config.VendorSpecs()))
	}
	byID := make(map[string]config.VendorStatus, len(vendors))
	active := 0
	for _, vendor := range vendors {
		byID[vendor.ID] = vendor
		if vendor.Active {
			active++
		}
	}
	if active != 1 {
		t.Fatalf("active vendor count = %d, want exactly 1", active)
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
	claude := byID["claude"]
	if !claude.Implemented || !claude.KeyConfigured || claude.Active {
		t.Fatalf("claude vendor = %#v", claude)
	}
	if len(claude.Models) != 2 || claude.Models[0] != "claude-sonnet-4-6" || claude.Models[1] != "claude-opus-4-6" {
		t.Fatalf("claude models = %#v", claude.Models)
	}
	for _, spec := range config.VendorSpecs() {
		vendor, listed := byID[spec.ID]
		if !listed {
			t.Fatalf("vendor %q is registered but missing from the list", spec.ID)
		}
		if !vendor.Implemented {
			t.Fatalf("vendor %q must be selectable", spec.ID)
		}
		if spec.NeedsKey() && (vendor.BaseURL == "" || len(vendor.Models) != 2) {
			t.Fatalf("vendor %q is not fully described: %#v", spec.ID, vendor)
		}
	}
	for _, unconfigured := range []string{"openai", "qwen", "glm", "volcengine"} {
		if byID[unconfigured].KeyConfigured {
			t.Fatalf("vendor %q reported a key that was never set", unconfigured)
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
