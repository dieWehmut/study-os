package app

import (
	"context"
	"path/filepath"
	"testing"

	"study-os/backend/config"
)

func TestMergeConfigFillsAllProviderSettingsWithoutOverwritingExplicitValues(t *testing.T) {
	configured := config.Config{
		ListenAddress:  "127.0.0.1:9000",
		DataDir:        "configured-data",
		DBPath:         "configured.db",
		ActiveProvider: "deepseek",
		AI: map[string]config.VendorConfig{
			"deepseek": {Model: "explicit-model"},
		},
	}
	loaded := config.Config{
		ListenAddress:  "127.0.0.1:8080",
		DataDir:        "loaded-data",
		DBPath:         "loaded.db",
		ActiveProvider: "mock",
		AI: map[string]config.VendorConfig{
			"deepseek": {
				APIKey:         "loaded-key",
				BaseURL:        "https://loaded.example/v1",
				Model:          "loaded-model",
				ReasoningModel: "loaded-reasoning-model",
			},
			"claude": {APIKey: "loaded-claude-key"},
		},
		SeedFixtures: true,
	}

	got := mergeConfig(configured, loaded)
	if got.ListenAddress != configured.ListenAddress || got.DataDir != configured.DataDir || got.DBPath != configured.DBPath || got.ActiveProvider != configured.ActiveProvider {
		t.Fatalf("core config was overwritten: %#v", got)
	}
	deepseek := got.AI["deepseek"]
	want := loaded.AI["deepseek"]
	if deepseek.APIKey != want.APIKey || deepseek.BaseURL != want.BaseURL || deepseek.ReasoningModel != want.ReasoningModel {
		t.Fatalf("provider settings were not merged: %#v", deepseek)
	}
	if deepseek.Model != "explicit-model" {
		t.Fatalf("explicit model was overwritten: %q", deepseek.Model)
	}
	// A vendor the application never mentioned must survive the merge, otherwise
	// switching providers at runtime would find an empty credential.
	if got.AI["claude"].APIKey != "loaded-claude-key" {
		t.Fatalf("unmentioned vendor was dropped: %#v", got.AI)
	}
	if !got.SeedFixtures {
		t.Fatal("loaded fixture flag should be preserved when configured value is false")
	}
}

func TestMergeConfigLeavesConfiguredProviderSettingsUntouched(t *testing.T) {
	configured := config.Config{
		AI: map[string]config.VendorConfig{
			"deepseek": {
				APIKey:         "configured-key",
				BaseURL:        "https://configured.example/v1",
				Model:          "configured-model",
				ReasoningModel: "configured-reasoning",
			},
		},
	}
	loaded := config.Config{
		AI: map[string]config.VendorConfig{
			"deepseek": {
				APIKey:         "loaded-key",
				BaseURL:        "https://loaded.example/v1",
				Model:          "loaded-model",
				ReasoningModel: "loaded-reasoning",
			},
		},
	}

	got := mergeConfig(configured, loaded)
	if got.AI["deepseek"] != configured.AI["deepseek"] {
		t.Fatalf("configured provider settings changed: %#v", got.AI)
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

// The updater is the only update path left once the PWA launcher is gone, so
// it must exist on every application the desktop app constructs, must follow
// the configured release channel and architecture, and must report a
// development build as having no managed install root rather than offering an
// update it would then refuse to apply.
func TestNewAlwaysBuildsTheDesktopUpdater(t *testing.T) {
	application, err := New(context.Background(), Options{Config: config.Config{
		DataDir:            t.TempDir(),
		UpdateRepo:         "example/study-os",
		UpdateArchitecture: "arm64",
	}})
	if err != nil {
		t.Fatalf("construct application: %v", err)
	}
	t.Cleanup(func() { _ = application.Close() })

	if application.Updater == nil {
		t.Fatal("updater missing: the desktop app would show no update surface")
	}
	if application.Updater.Repo != "example/study-os" {
		t.Errorf("repo = %q", application.Updater.Repo)
	}
	if application.Updater.AssetArch != "arm64" {
		t.Errorf("asset architecture = %q", application.Updater.AssetArch)
	}
	if application.Updater.Version == "" {
		t.Error("current version is empty, so nothing could be compared")
	}
	// A test binary is not installed under <root>\versions\<version>, so the
	// updater must stay off rather than overwrite a directory nobody owns.
	if application.Updater.InstallRoot != "" {
		t.Errorf("install root = %q, want empty for an unmanaged build", application.Updater.InstallRoot)
	}
}
func TestConfigNeedsDefaultsDoesNotLoadOptionalProviderFieldsForMock(t *testing.T) {
	cfg := config.Config{
		ListenAddress:  "127.0.0.1:0",
		DataDir:        t.TempDir(),
		DBPath:         filepath.Join(t.TempDir(), "study.db"),
		ActiveProvider: "mock",
	}
	if configNeedsDefaults(cfg) {
		t.Fatal("mock config with complete core fields should not require env defaults")
	}
}
