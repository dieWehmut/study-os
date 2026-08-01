package app

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"

	"study-os/backend/config"
	"study-os/backend/db"
)

type Options struct {
	Config  config.Config
	DBPath  string
	DataDir string
}

type App struct {
	Config config.Config
	Store  *db.Store
}

func New(ctx context.Context, options Options) (*App, error) {
	cfg := options.Config
	if cfg.ListenAddress == "" || cfg.DataDir == "" || cfg.DBPath == "" || cfg.AIProvider == "" {
		loaded, err := config.Load()
		if err != nil {
			return nil, fmt.Errorf("load application configuration: %w", err)
		}
		if cfg.ListenAddress == "" {
			cfg.ListenAddress = loaded.ListenAddress
		}
		if cfg.DataDir == "" {
			cfg.DataDir = loaded.DataDir
		}
		if cfg.DBPath == "" {
			cfg.DBPath = loaded.DBPath
		}
		if cfg.AIProvider == "" {
			cfg.AIProvider = loaded.AIProvider
		}
		if !cfg.SeedFixtures {
			cfg.SeedFixtures = loaded.SeedFixtures
		}
	}
	if options.DataDir != "" {
		cfg.DataDir = options.DataDir
	}
	if options.DBPath != "" {
		cfg.DBPath = options.DBPath
	} else if options.DataDir != "" {
		cfg.DBPath = filepath.Join(options.DataDir, "study.db")
	}

	databaseOptions := make([]db.OpenOption, 0, 1)
	if cfg.SeedFixtures {
		databaseOptions = append(databaseOptions, db.WithFixtureSeed())
	}
	store, err := db.Open(ctx, cfg.DBPath, databaseOptions...)
	if err != nil {
		return nil, fmt.Errorf("open application store: %w", err)
	}
	return &App{Config: cfg, Store: store}, nil
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
