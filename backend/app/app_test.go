package app

import (
	"context"
	"path/filepath"
	"testing"

	"study-os/backend/config"
)

func TestMergeConfigFillsAllProviderSettingsWithoutOverwritingExplicitValues(t *testing.T) {
	configured := config.Config{
		ListenAddress: "127.0.0.1:9000",
		DataDir:       "configured-data",
		DBPath:        "configured.db",
		AIProvider:    "openai",
		OpenAIModel:   "explicit-model",
	}
	loaded := config.Config{
		ListenAddress: "127.0.0.1:8080",
		DataDir:       "loaded-data",
		DBPath:        "loaded.db",
		AIProvider:    "mock",
		OpenAIAPIKey:  "loaded-key",
		OpenAIBaseURL: "https://loaded.example/v1",
		OpenAIModel:   "loaded-model",
		SeedFixtures:  true,
	}

	got := mergeConfig(configured, loaded)
	if got.ListenAddress != configured.ListenAddress || got.DataDir != configured.DataDir || got.DBPath != configured.DBPath || got.AIProvider != configured.AIProvider {
		t.Fatalf("core config was overwritten: %#v", got)
	}
	if got.OpenAIAPIKey != loaded.OpenAIAPIKey || got.OpenAIBaseURL != loaded.OpenAIBaseURL {
		t.Fatalf("provider settings were not merged: %#v", got)
	}
	if got.OpenAIModel != configured.OpenAIModel {
		t.Fatalf("explicit model was overwritten: %q", got.OpenAIModel)
	}
	if !got.SeedFixtures {
		t.Fatal("loaded fixture flag should be preserved when configured value is false")
	}
}

func TestMergeConfigLeavesConfiguredProviderSettingsUntouched(t *testing.T) {
	configured := config.Config{
		OpenAIAPIKey:  "configured-key",
		OpenAIBaseURL: "https://configured.example/v1",
		OpenAIModel:   "configured-model",
	}
	loaded := config.Config{
		OpenAIAPIKey:  "loaded-key",
		OpenAIBaseURL: "https://loaded.example/v1",
		OpenAIModel:   "loaded-model",
	}

	got := mergeConfig(configured, loaded)
	if got.OpenAIAPIKey != configured.OpenAIAPIKey || got.OpenAIBaseURL != configured.OpenAIBaseURL || got.OpenAIModel != configured.OpenAIModel {
		t.Fatalf("configured provider settings changed: %#v", got)
	}
}

func TestApplyPathOverridesRebasesDefaultDatabaseUnderExplicitDataDirectory(t *testing.T) {
	cfg := config.Config{DataDir: "loaded-data", DBPath: "loaded-data/study.db"}

	got := applyPathOverrides(cfg, Options{DataDir: "desktop-data"})
	if got.DataDir != "desktop-data" {
		t.Fatalf("data dir = %q, want %q", got.DataDir, "desktop-data")
	}
	want := filepath.Join("desktop-data", "study.db")
	if got.DBPath != want {
		t.Fatalf("database path = %q, want %q", got.DBPath, want)
	}
}

func TestApplyPathOverridesPreservesExplicitDatabaseOverride(t *testing.T) {
	cfg := config.Config{DataDir: "loaded-data", DBPath: "loaded-data/study.db"}

	got := applyPathOverrides(cfg, Options{DataDir: "desktop-data", DBPath: "custom/knowledge.db"})
	if got.DBPath != "custom/knowledge.db" {
		t.Fatalf("database path = %q, want explicit override", got.DBPath)
	}
}

func TestApplyPathOverridesPreservesCustomStudyDatabaseOutsidePreviousDataDirectory(t *testing.T) {
	cfg := config.Config{DataDir: "loaded-data", DBPath: filepath.Join("custom", "study.db")}

	got := applyPathOverrides(cfg, Options{DataDir: "desktop-data"})
	if got.DBPath != cfg.DBPath {
		t.Fatalf("database path = %q, want custom path %q", got.DBPath, cfg.DBPath)
	}
}

func TestApplyPathOverridesUsesDatabaseOverrideWithoutDataDirectory(t *testing.T) {
	cfg := config.Config{DataDir: "loaded-data", DBPath: filepath.Join("loaded-data", "study.db")}

	got := applyPathOverrides(cfg, Options{DBPath: filepath.Join("isolated", "test.db")})
	if got.DBPath != filepath.Join("isolated", "test.db") {
		t.Fatalf("database path = %q, want explicit override", got.DBPath)
	}
	if got.DataDir != cfg.DataDir {
		t.Fatalf("data dir = %q, want %q", got.DataDir, cfg.DataDir)
	}
}

func TestNewUsesDatabaseOverrideWithoutDataDirectory(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "isolated.db")
	application, err := New(context.Background(), Options{DBPath: dbPath})
	if err != nil {
		t.Fatalf("construct application: %v", err)
	}
	t.Cleanup(func() { _ = application.Close() })

	if application.Config.DBPath != dbPath {
		t.Fatalf("database path = %q, want %q", application.Config.DBPath, dbPath)
	}
}

func TestConfigNeedsDefaultsDoesNotLoadOptionalProviderFieldsForMock(t *testing.T) {
	cfg := config.Config{
		ListenAddress: "127.0.0.1:0",
		DataDir:       t.TempDir(),
		DBPath:        filepath.Join(t.TempDir(), "study.db"),
		AIProvider:    "mock",
	}
	if configNeedsDefaults(cfg) {
		t.Fatal("mock config with complete core fields should not require env defaults")
	}
}
