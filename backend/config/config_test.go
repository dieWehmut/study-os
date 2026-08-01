package config_test

import (
	"os"
	"path/filepath"
	"testing"

	"study-os/backend/config"
)

func TestFromLookupUsesSafeDefaults(t *testing.T) {
	cfg, err := config.FromLookup(func(string) (string, bool) { return "", false })
	if err != nil {
		t.Fatalf("load defaults: %v", err)
	}

	if cfg.ListenAddress != "127.0.0.1:8080" {
		t.Fatalf("listen address = %q", cfg.ListenAddress)
	}
	if cfg.DataDir != "data" {
		t.Fatalf("data dir = %q", cfg.DataDir)
	}
	if cfg.DBPath != filepath.Join("data", "study.db") {
		t.Fatalf("database path = %q", cfg.DBPath)
	}
	if cfg.AIProvider != "mock" {
		t.Fatalf("AI provider = %q", cfg.AIProvider)
	}
	if cfg.SeedFixtures {
		t.Fatal("fixtures must not be seeded by default")
	}
}

func TestLoadFromFileUsesProcessEnvironmentBeforeEnvFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".env.local")
	contents := "AI_PROVIDER=openai\nOPENAI_API_KEY=from-file\nOPENAI_BASE_URL= https://example.test/v1 \nOPENAI_MODEL=small-model\n"
	if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
		t.Fatalf("write env file: %v", err)
	}
	values := map[string]string{"OPENAI_API_KEY": "from-process"}
	cfg, err := config.LoadFromFile(path, func(key string) (string, bool) {
		value, ok := values[key]
		return value, ok
	})
	if err != nil {
		t.Fatalf("load env file: %v", err)
	}
	if cfg.AIProvider != "openai" {
		t.Fatalf("provider = %q", cfg.AIProvider)
	}
	if cfg.OpenAIAPIKey != "from-process" {
		t.Fatalf("key priority = %q", cfg.OpenAIAPIKey)
	}
	if cfg.OpenAIBaseURL != "https://example.test/v1" || cfg.OpenAIModel != "small-model" {
		t.Fatalf("openai settings = %#v", cfg)
	}
}

func TestLoadFromFileRejectsMalformedEntries(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".env.local")
	if err := os.WriteFile(path, []byte("not-an-assignment\n"), 0o600); err != nil {
		t.Fatalf("write env file: %v", err)
	}
	if _, err := config.LoadFromFile(path, func(string) (string, bool) { return "", false }); err == nil {
		t.Fatal("expected malformed env entry error")
	}
}

func TestFromLookupUsesOverrides(t *testing.T) {
	values := map[string]string{
		"STUDY_OS_LISTEN_ADDRESS": "localhost:9090",
		"STUDY_OS_DATA_DIR":       filepath.Join("var", "study-os"),
		"STUDY_OS_DB_PATH":        filepath.Join("var", "database.sqlite"),
		"STUDY_OS_SEED_FIXTURES":  "true",
		"AI_PROVIDER":             "openai",
	}

	cfg, err := config.FromLookup(func(key string) (string, bool) {
		value, ok := values[key]
		return value, ok
	})
	if err != nil {
		t.Fatalf("load overrides: %v", err)
	}

	if cfg.ListenAddress != values["STUDY_OS_LISTEN_ADDRESS"] {
		t.Fatalf("listen address = %q", cfg.ListenAddress)
	}
	if cfg.DataDir != values["STUDY_OS_DATA_DIR"] {
		t.Fatalf("data dir = %q", cfg.DataDir)
	}
	if cfg.DBPath != values["STUDY_OS_DB_PATH"] {
		t.Fatalf("database path = %q", cfg.DBPath)
	}
	if cfg.AIProvider != "openai" {
		t.Fatalf("AI provider = %q", cfg.AIProvider)
	}
	if !cfg.SeedFixtures {
		t.Fatal("fixtures should be enabled by explicit configuration")
	}
}

func TestFromLookupRejectsNonLoopbackListener(t *testing.T) {
	_, err := config.FromLookup(func(key string) (string, bool) {
		if key == "STUDY_OS_LISTEN_ADDRESS" {
			return "0.0.0.0:8080", true
		}
		return "", false
	})
	if err == nil {
		t.Fatal("expected a non-loopback listener error")
	}
}
