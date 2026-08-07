package app

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"strings"

	"study-os/backend/audio"
	"study-os/backend/backup"
	"study-os/backend/config"
	"study-os/backend/db"
	"study-os/backend/launcher"
	"study-os/backend/models"
	"study-os/backend/version"
)

type Options struct {
	Config  config.Config
	DBPath  string
	DataDir string
}

type App struct {
	Config   config.Config
	Store    *db.Store
	Backups  *backup.Service
	Audio    *audio.Service
	Launcher *launcher.Service
}

func New(ctx context.Context, options Options) (*App, error) {
	cfg := options.Config
	if configNeedsDefaults(cfg) {
		loaded, err := config.Load()
		if err != nil {
			return nil, fmt.Errorf("load application configuration: %w", err)
		}
		cfg = mergeConfig(cfg, loaded)
	}
	cfg = applyPathOverrides(cfg, options)

	databaseOptions := make([]db.OpenOption, 0, 1)
	if cfg.SeedFixtures {
		databaseOptions = append(databaseOptions, db.WithFixtureSeed())
	}
	store, err := db.Open(ctx, cfg.DBPath, databaseOptions...)
	if err != nil {
		return nil, fmt.Errorf("open application store: %w", err)
	}
	generator := audio.Generator(audio.NewSAPIProvider())
	if cfg.DashScopeAPIKey != "" {
		cloudGenerator, err := audio.NewDashScopeProvider(cfg.DashScopeAPIKey, cfg.DashScopeVoice)
		if err != nil {
			_ = store.Close()
			return nil, fmt.Errorf("create cloud audio provider: %w", err)
		}
		generator = cloudGenerator
	}
	audioService, err := audio.NewService(filepath.Join(cfg.DataDir, "audio-cache"),
		audio.WithLocalDir(filepath.Join(cfg.DataDir, "audio")),
		audio.WithGenerator(generator),
	)
	if err != nil {
		_ = store.Close()
		return nil, fmt.Errorf("create audio service: %w", err)
	}
	var launcherService *launcher.Service
	if cfg.Launcher {
		staticDir, err := filepath.Abs(cfg.StaticDir)
		if err != nil {
			_ = store.Close()
			return nil, fmt.Errorf("resolve static directory: %w", err)
		}
		launcherService = launcher.NewService(launcher.Options{
			StaticDir: staticDir,
			Repo:      cfg.UpdateRepo,
			Version:   version.Version,
			DataDir:   cfg.DataDir,
		})
	}
	return &App{
		Config:   cfg,
		Store:    store,
		Backups:  backup.NewService(filepath.Join(cfg.DataDir, "backups")),
		Audio:    audioService,
		Launcher: launcherService,
	}, nil
}

func (a *App) RecordBackup(ctx context.Context, result backup.Result) (models.BackupRecord, error) {
	if a == nil || a.Store == nil {
		return models.BackupRecord{}, errors.New("application store is unavailable")
	}
	record := models.BackupRecord{
		ID:        strings.TrimSuffix(filepath.Base(result.Path), filepath.Ext(result.Path)),
		Category:  string(result.Category),
		Path:      result.Path,
		SHA256:    result.SHA256,
		SizeBytes: result.Size,
		CreatedAt: result.CreatedAt,
	}
	if err := a.Store.CreateBackupRecord(ctx, record); err != nil {
		return models.BackupRecord{}, err
	}
	return record, nil
}

func configNeedsDefaults(cfg config.Config) bool {
	if cfg.ListenAddress == "" || cfg.DataDir == "" || cfg.DBPath == "" || cfg.ActiveProvider == "" {
		return true
	}
	// Vendor credentials are optional for the default mock provider. Do not make
	// a fully specified mock application read an env file just to fill unused
	// fields, but still let a hosted-vendor app inherit its provider settings.
	// Base URL and model always resolve from the registry, so the key is the
	// only setting that can genuinely be absent.
	spec, ok := config.LookupVendor(cfg.ActiveProvider)
	if !ok || !spec.NeedsKey() {
		return false
	}
	return cfg.Vendor(spec.ID).APIKey == ""
}

func mergeConfig(configured, loaded config.Config) config.Config {
	if configured.ListenAddress == "" {
		configured.ListenAddress = loaded.ListenAddress
	}
	if configured.DataDir == "" {
		configured.DataDir = loaded.DataDir
	}
	if configured.DBPath == "" {
		configured.DBPath = loaded.DBPath
	}
	if configured.ActiveProvider == "" {
		configured.ActiveProvider = loaded.ActiveProvider
	}
	if configured.EnvFilePath == "" {
		configured.EnvFilePath = loaded.EnvFilePath
	}
	configured.AI = mergeVendors(configured.AI, loaded.AI)
	if configured.DashScopeAPIKey == "" {
		configured.DashScopeAPIKey = loaded.DashScopeAPIKey
	}
	if configured.DashScopeVoice == "" {
		configured.DashScopeVoice = loaded.DashScopeVoice
	}
	if !configured.SeedFixtures {
		configured.SeedFixtures = loaded.SeedFixtures
	}
	return configured
}

// mergeVendors fills per-vendor gaps field by field rather than per vendor, so
// an application that sets only one vendor's key still inherits that vendor's
// base URL and models from the environment.
func mergeVendors(configured, loaded map[string]config.VendorConfig) map[string]config.VendorConfig {
	if len(loaded) == 0 {
		return configured
	}
	merged := make(map[string]config.VendorConfig, len(loaded)+len(configured))
	for id, vendor := range loaded {
		merged[id] = vendor
	}
	for id, vendor := range configured {
		fallback := merged[id]
		if vendor.APIKey == "" {
			vendor.APIKey = fallback.APIKey
		}
		if vendor.BaseURL == "" {
			vendor.BaseURL = fallback.BaseURL
		}
		if vendor.Model == "" {
			vendor.Model = fallback.Model
		}
		if vendor.ReasoningModel == "" {
			vendor.ReasoningModel = fallback.ReasoningModel
		}
		merged[id] = vendor
	}
	return merged
}

func applyPathOverrides(cfg config.Config, options Options) config.Config {
	if options.DataDir == "" {
		if options.DBPath != "" {
			cfg.DBPath = options.DBPath
		}
		return cfg
	}
	previousDataDir := cfg.DataDir
	cfg.DataDir = options.DataDir
	if options.DBPath != "" {
		cfg.DBPath = options.DBPath
		return cfg
	}
	// A loaded/default database path follows its data directory. Preserve a
	// deliberately custom path when it does not point inside the old data dir.
	cleanDB := filepath.Clean(cfg.DBPath)
	cleanData := filepath.Clean(previousDataDir)
	if cleanDB == filepath.Join(cleanData, "study.db") {
		cfg.DBPath = filepath.Join(options.DataDir, "study.db")
	}
	return cfg
}

func (a *App) Close() error {
	if a == nil || a.Store == nil {
		return nil
	}
	if err := a.Store.Close(); err != nil && !errors.Is(err, context.Canceled) {
		return fmt.Errorf("close application store: %w", err)
	}
	return nil
}
