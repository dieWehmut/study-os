package db

import (
	"context"
	"database/sql"
	_ "embed"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	_ "modernc.org/sqlite"
)

//go:embed schema.sql
var schemaSQL string

const currentSchemaVersion = 2

type openOptions struct {
	seedFixtures bool
}

type OpenOption func(*openOptions)

func WithFixtureSeed() OpenOption {
	return func(options *openOptions) {
		options.seedFixtures = true
	}
}

func Open(ctx context.Context, path string, options ...OpenOption) (*Store, error) {
	if strings.TrimSpace(path) == "" {
		return nil, errors.New("database path is empty")
	}
	settings := openOptions{}
	for _, option := range options {
		if option != nil {
			option(&settings)
		}
	}

	absolutePath, err := filepath.Abs(path)
	if err != nil {
		return nil, fmt.Errorf("resolve database path: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(absolutePath), 0o700); err != nil {
		return nil, fmt.Errorf("create database directory: %w", err)
	}

	database, err := sql.Open("sqlite", absolutePath)
	if err != nil {
		return nil, fmt.Errorf("open sqlite database: %w", err)
	}
	// A single connection makes connection-local PRAGMAs deterministic while WAL
	// still allows backup/read tooling to access the file concurrently.
	database.SetMaxOpenConns(1)
	database.SetMaxIdleConns(1)
	if err := configure(ctx, database); err != nil {
		_ = database.Close()
		return nil, err
	}
	if err := migrate(ctx, database); err != nil {
		_ = database.Close()
		return nil, err
	}

	store := NewStore(database)
	if settings.seedFixtures {
		if err := store.seedFixtures(ctx); err != nil {
			_ = store.Close()
			return nil, fmt.Errorf("seed fixtures: %w", err)
		}
	}
	return store, nil
}

func configure(ctx context.Context, database *sql.DB) error {
	statements := []string{
		`PRAGMA journal_mode = WAL`,
		`PRAGMA foreign_keys = ON`,
		`PRAGMA busy_timeout = 5000`,
		`PRAGMA synchronous = NORMAL`,
	}
	for _, statement := range statements {
		if _, err := database.ExecContext(ctx, statement); err != nil {
			return fmt.Errorf("configure sqlite with %q: %w", statement, err)
		}
	}
	return nil
}

func migrate(ctx context.Context, database *sql.DB) error {
	tx, err := database.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin migration: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version INTEGER PRIMARY KEY,
			applied_at TEXT NOT NULL
		)`); err != nil {
		return fmt.Errorf("create migration table: %w", err)
	}
	versions, err := migrationVersions(ctx, tx)
	if err != nil {
		return err
	}
	for _, version := range versions {
		if version > currentSchemaVersion || version < 1 {
			return fmt.Errorf("unsupported schema migration version %d", version)
		}
	}
	if len(versions) == 0 {
		if _, err := tx.ExecContext(ctx, schemaSQL); err != nil {
			return fmt.Errorf("apply schema version %d: %w", currentSchemaVersion, err)
		}
		if err := recordMigration(ctx, tx, currentSchemaVersion); err != nil {
			return err
		}
	} else if containsVersion(versions, currentSchemaVersion) {
		if !hasColumn(ctx, tx, "import_jobs", "original_name") {
			return errors.New("schema version 2 is recorded but import_jobs.original_name is missing")
		}
	} else {
		if len(versions) != 1 || versions[0] != 1 {
			return fmt.Errorf("unsupported schema migration sequence %v", versions)
		}
		if !hasColumn(ctx, tx, "import_jobs", "original_name") {
			if _, err := tx.ExecContext(ctx, `ALTER TABLE import_jobs ADD COLUMN original_name TEXT NOT NULL DEFAULT ''`); err != nil {
				return fmt.Errorf("apply schema version %d: %w", currentSchemaVersion, err)
			}
		}
		if err := recordMigration(ctx, tx, currentSchemaVersion); err != nil {
			return err
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit migration: %w", err)
	}
	return nil
}

func migrationVersions(ctx context.Context, tx *sql.Tx) ([]int, error) {
	rows, err := tx.QueryContext(ctx, `SELECT version FROM schema_migrations ORDER BY version ASC`)
	if err != nil {
		return nil, fmt.Errorf("list migration versions: %w", err)
	}
	defer rows.Close()
	versions := make([]int, 0)
	for rows.Next() {
		var version int
		if err := rows.Scan(&version); err != nil {
			return nil, fmt.Errorf("scan migration version: %w", err)
		}
		versions = append(versions, version)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate migration versions: %w", err)
	}
	return versions, nil
}

func recordMigration(ctx context.Context, tx *sql.Tx, version int) error {
	if _, err := tx.ExecContext(ctx, `INSERT INTO schema_migrations(version, applied_at) VALUES (?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`, version); err != nil {
		return fmt.Errorf("record schema version: %w", err)
	}
	return nil
}

func containsVersion(versions []int, target int) bool {
	for _, version := range versions {
		if version == target {
			return true
		}
	}
	return false
}

func hasColumn(ctx context.Context, tx *sql.Tx, table, column string) bool {
	rows, err := tx.QueryContext(ctx, `PRAGMA table_info(`+table+`)`)
	if err != nil {
		return false
	}
	defer rows.Close()
	for rows.Next() {
		var cid int
		var name, columnType string
		var notNull, primaryKey int
		var defaultValue any
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &primaryKey); err == nil && name == column {
			return true
		}
	}
	return false
}
