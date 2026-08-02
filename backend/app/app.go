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
	"study-os/backend/models"
)

type Options struct {
	Config  config.Config
	DBPath  string
	DataDir string
}

type App struct {
	Config  config.Config
	Store   *db.Store
	Backups *backup.Service
	Audio   *audio.Service
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
	audioService, err := audio.NewService(filepath.Join(cfg.DataDir, "audio-cache"),
		audio.WithLocalDir(filepath.Join(cfg.DataDir, "audio")),
		audio.WithGenerator(audio.NewSAPIProvider()),
	)
	if err != nil {
		_ = store.Close()
		return nil, fmt.Errorf("create audio service: %w", err)
	}
	return &App{
		Config:  cfg,
		Store:   store,
		Backups: backup.NewService(filepath.Join(cfg.DataDir, "backups")),
		Audio:   audioService,
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
	if cfg.ListenAddress == "" || cfg.DataDir == "" || cfg.DBPath == "" || cfg.AIProvider == "" {
		return true
	}
	// OpenAI settings are optional for the default mock provider. Do not make a
	// fully specified mock application read an env file just to fill unused
	// fields, but still allow an OpenAI app to inherit provider settings.
	return cfg.AIProvider == "openai" &&
		(cfg.OpenAIAPIKey == "" || cfg.OpenAIBaseURL == "" || cfg.OpenAIModel == "")
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
	if configured.AIProvider == "" {
		configured.AIProvider = loaded.AIProvider
	}
	if configured.OpenAIAPIKey == "" {
		configured.OpenAIAPIKey = loaded.OpenAIAPIKey
	}
	if configured.OpenAIBaseURL == "" {
		configured.OpenAIBaseURL = loaded.OpenAIBaseURL
	}
	if configured.OpenAIModel == "" {
		configured.OpenAIModel = loaded.OpenAIModel
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
