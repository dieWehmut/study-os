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
	// DeepSeek settings are optional for the default mock provider. Do not make
	// a fully specified mock application read an env file just to fill unused
	// fields, but still allow a DeepSeek app to inherit provider settings.
	return cfg.ActiveProvider == "deepseek" &&
		(cfg.DeepSeek.APIKey == "" || cfg.DeepSeek.BaseURL == "" || cfg.DeepSeek.Model == "")
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
	if configured.DeepSeek.APIKey == "" {
		configured.DeepSeek.APIKey = loaded.DeepSeek.APIKey
	}
	if configured.DeepSeek.BaseURL == "" {
		configured.DeepSeek.BaseURL = loaded.DeepSeek.BaseURL
	}
	if configured.DeepSeek.Model == "" {
		configured.DeepSeek.Model = loaded.DeepSeek.Model
	}
	if configured.DeepSeek.ReasoningModel == "" {
		configured.DeepSeek.ReasoningModel = loaded.DeepSeek.ReasoningModel
	}
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
