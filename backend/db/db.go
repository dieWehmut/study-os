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

const currentSchemaVersion = 13

// SchemaVersion is the version a freshly opened store is migrated to. Exported
// so migration tests can express "the head of the ladder" instead of a literal
// that has to be edited in three places every time the schema grows.
const SchemaVersion = currentSchemaVersion

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
	latest := 0
	if len(versions) > 0 {
		latest = versions[len(versions)-1]
	}
	if latest == 0 {
		if _, err := tx.ExecContext(ctx, schemaSQL); err != nil {
			return fmt.Errorf("apply schema version %d: %w", currentSchemaVersion, err)
		}
		if err := recordMigration(ctx, tx, currentSchemaVersion); err != nil {
			return err
		}
	} else {
		for version := latest + 1; version <= currentSchemaVersion; version++ {
			if err := applyMigration(ctx, tx, version); err != nil {
				return err
			}
			if err := recordMigration(ctx, tx, version); err != nil {
				return err
			}
		}
	}
	if err := verifySchema(ctx, tx, currentSchemaVersion); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit migration: %w", err)
	}
	return nil
}

func applyMigration(ctx context.Context, tx *sql.Tx, version int) error {
	switch version {
	case 2:
		if !hasColumn(ctx, tx, "import_jobs", "original_name") {
			if _, err := tx.ExecContext(ctx, `ALTER TABLE import_jobs ADD COLUMN original_name TEXT NOT NULL DEFAULT ''`); err != nil {
				return fmt.Errorf("apply schema version %d: %w", version, err)
			}
		}
	case 3:
		statements := []string{
			`CREATE TABLE IF NOT EXISTS knowledge_groups (
				id TEXT PRIMARY KEY,
				name TEXT NOT NULL,
				kind TEXT NOT NULL DEFAULT '',
				parent_id TEXT REFERENCES knowledge_groups(id) ON DELETE SET NULL,
				sort_order INTEGER NOT NULL DEFAULT 0,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			)`,
			`CREATE INDEX IF NOT EXISTS knowledge_groups_parent_idx ON knowledge_groups(parent_id)`,
			`CREATE TABLE IF NOT EXISTS knowledge_item_groups (
				knowledge_item_id TEXT NOT NULL REFERENCES knowledge_items(id) ON DELETE CASCADE,
				group_id TEXT NOT NULL REFERENCES knowledge_groups(id) ON DELETE CASCADE,
				PRIMARY KEY (knowledge_item_id, group_id)
			)`,
			`CREATE INDEX IF NOT EXISTS knowledge_item_groups_group_idx ON knowledge_item_groups(group_id)`,
			`CREATE TABLE IF NOT EXISTS audio_assets (
				id TEXT PRIMARY KEY,
				knowledge_item_id TEXT REFERENCES knowledge_items(id) ON DELETE CASCADE,
				source_type TEXT NOT NULL,
				uri TEXT NOT NULL,
				attribution TEXT NOT NULL DEFAULT '',
				provider TEXT NOT NULL DEFAULT '',
				voice TEXT NOT NULL DEFAULT '',
				timeline_json TEXT NOT NULL DEFAULT '{}',
				created_at TEXT NOT NULL
			)`,
		}
		for _, statement := range statements {
			if _, err := tx.ExecContext(ctx, statement); err != nil {
				return fmt.Errorf("apply schema version %d: %w", version, err)
			}
		}
		for _, column := range []struct{ name, definition string }{
			{"provider", `ALTER TABLE audio_assets ADD COLUMN provider TEXT NOT NULL DEFAULT ''`},
			{"voice", `ALTER TABLE audio_assets ADD COLUMN voice TEXT NOT NULL DEFAULT ''`},
			{"timeline_json", `ALTER TABLE audio_assets ADD COLUMN timeline_json TEXT NOT NULL DEFAULT '{}'`},
		} {
			if !hasColumn(ctx, tx, "audio_assets", column.name) {
				if _, err := tx.ExecContext(ctx, column.definition); err != nil {
					return fmt.Errorf("apply schema version %d: %w", version, err)
				}
			}
		}
	case 4:
		if !hasColumn(ctx, tx, "knowledge_items", "subject") {
			if _, err := tx.ExecContext(ctx, `ALTER TABLE knowledge_items ADD COLUMN subject TEXT NOT NULL DEFAULT ''`); err != nil {
				return fmt.Errorf("apply schema version %d: %w", version, err)
			}
		}
	case 5:
		if _, err := tx.ExecContext(ctx, `
			CREATE TABLE IF NOT EXISTS chat_messages (
				id TEXT PRIMARY KEY,
				session_id TEXT NOT NULL DEFAULT '',
				subject TEXT NOT NULL DEFAULT '',
				role TEXT NOT NULL,
				content TEXT NOT NULL,
				status TEXT NOT NULL DEFAULT 'pending',
				error_summary TEXT NOT NULL DEFAULT '',
				created_at TEXT NOT NULL
			)`); err != nil {
			return fmt.Errorf("apply schema version %d: %w", version, err)
		}
		if _, err := tx.ExecContext(ctx, `
			CREATE INDEX IF NOT EXISTS chat_messages_subject_idx ON chat_messages(subject, created_at DESC)`); err != nil {
			return fmt.Errorf("apply schema version %d: %w", version, err)
		}
	case 6:
		if _, err := tx.ExecContext(ctx, `
			CREATE TABLE IF NOT EXISTS integrated_notes (
				id TEXT PRIMARY KEY,
				subject TEXT NOT NULL DEFAULT '',
				title TEXT NOT NULL,
				source_type TEXT NOT NULL DEFAULT '',
				source_id TEXT NOT NULL DEFAULT '',
				mindmap_json TEXT NOT NULL DEFAULT '{}',
				cards_json TEXT NOT NULL DEFAULT '[]',
				created_at TEXT NOT NULL
			)`); err != nil {
			return fmt.Errorf("apply schema version %d: %w", version, err)
		}
		if _, err := tx.ExecContext(ctx, `
			CREATE INDEX IF NOT EXISTS integrated_notes_subject_idx ON integrated_notes(subject, created_at DESC)`); err != nil {
			return fmt.Errorf("apply schema version %d: %w", version, err)
		}
	case 7:
		if _, err := tx.ExecContext(ctx, `
			CREATE TABLE IF NOT EXISTS chat_attachments (
				id TEXT PRIMARY KEY,
				session_id TEXT NOT NULL DEFAULT '',
				subject TEXT NOT NULL DEFAULT '',
				message_id TEXT NOT NULL DEFAULT '',
				name TEXT NOT NULL,
				stored_path TEXT NOT NULL,
				size_bytes INTEGER NOT NULL DEFAULT 0,
				kind TEXT NOT NULL DEFAULT '',
				created_at TEXT NOT NULL
			)`); err != nil {
			return fmt.Errorf("apply schema version %d: %w", version, err)
		}
		if _, err := tx.ExecContext(ctx, `
			CREATE INDEX IF NOT EXISTS chat_attachments_session_idx ON chat_attachments(session_id, created_at DESC)`); err != nil {
			return fmt.Errorf("apply schema version %d: %w", version, err)
		}
	case 8:
		if _, err := tx.ExecContext(ctx, `
			CREATE TABLE IF NOT EXISTS questions (
				id TEXT PRIMARY KEY,
				subject TEXT NOT NULL DEFAULT '',
				stem TEXT NOT NULL,
				source_id TEXT NOT NULL DEFAULT '',
				created_at TEXT NOT NULL
			)`); err != nil {
			return fmt.Errorf("apply schema version %d: %w", version, err)
		}
		if _, err := tx.ExecContext(ctx, `
			CREATE INDEX IF NOT EXISTS questions_subject_idx ON questions(subject, created_at DESC)`); err != nil {
			return fmt.Errorf("apply schema version %d: %w", version, err)
		}
		if _, err := tx.ExecContext(ctx, `
			CREATE TABLE IF NOT EXISTS question_attempts (
				id TEXT PRIMARY KEY,
				question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
				cause TEXT NOT NULL DEFAULT '',
				note TEXT NOT NULL DEFAULT '',
				occurred_at TEXT NOT NULL
			)`); err != nil {
			return fmt.Errorf("apply schema version %d: %w", version, err)
		}
		if _, err := tx.ExecContext(ctx, `
			CREATE INDEX IF NOT EXISTS question_attempts_question_idx ON question_attempts(question_id, occurred_at DESC)`); err != nil {
			return fmt.Errorf("apply schema version %d: %w", version, err)
		}
	case 9:
		if !hasColumn(ctx, tx, "questions", "knowledge_item_id") {
			if _, err := tx.ExecContext(ctx, `
				ALTER TABLE questions ADD COLUMN knowledge_item_id TEXT NOT NULL DEFAULT ''`); err != nil {
				return fmt.Errorf("apply schema version %d: %w", version, err)
			}
		}
	case 10:
		if _, err := tx.ExecContext(ctx, `
			CREATE TABLE IF NOT EXISTS voice_roles (
				id TEXT PRIMARY KEY,
				name TEXT NOT NULL,
				bio TEXT NOT NULL DEFAULT '',
				avatar_path TEXT NOT NULL DEFAULT '',
				provider TEXT NOT NULL DEFAULT '',
				base_url TEXT NOT NULL DEFAULT '',
				model TEXT NOT NULL DEFAULT '',
				voice TEXT NOT NULL DEFAULT '',
				sort_order INTEGER NOT NULL DEFAULT 0,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			)`); err != nil {
			return fmt.Errorf("apply schema version %d: %w", version, err)
		}
		if _, err := tx.ExecContext(ctx, `
			CREATE INDEX IF NOT EXISTS voice_roles_order_idx ON voice_roles(sort_order, created_at)`); err != nil {
			return fmt.Errorf("apply schema version %d: %w", version, err)
		}
	case 11:
		if _, err := tx.ExecContext(ctx, `
			CREATE TABLE IF NOT EXISTS english_articles (
				id TEXT PRIMARY KEY,
				title TEXT NOT NULL,
				original_title TEXT NOT NULL DEFAULT '',
				author TEXT NOT NULL DEFAULT '',
				source_name TEXT NOT NULL DEFAULT '',
				source_url TEXT NOT NULL DEFAULT '',
				published_at TEXT NOT NULL DEFAULT '',
				original_text TEXT NOT NULL,
				content_json TEXT NOT NULL DEFAULT '{}',
				markdown TEXT NOT NULL,
				provider TEXT NOT NULL DEFAULT '',
				model TEXT NOT NULL DEFAULT '',
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			)`); err != nil {
			return fmt.Errorf("apply schema version %d: %w", version, err)
		}
		if _, err := tx.ExecContext(ctx, `
			CREATE INDEX IF NOT EXISTS english_articles_updated_idx ON english_articles(updated_at DESC)`); err != nil {
			return fmt.Errorf("apply schema version %d: %w", version, err)
		}
	case 12:
		statements := []string{
			`CREATE TABLE IF NOT EXISTS lessons (
				id TEXT PRIMARY KEY,
				subject TEXT NOT NULL DEFAULT '',
				title TEXT NOT NULL,
				source_type TEXT NOT NULL DEFAULT '',
				source_id TEXT NOT NULL DEFAULT '',
				status TEXT NOT NULL DEFAULT 'draft',
				current_version INTEGER NOT NULL DEFAULT 1,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			)`,
			`CREATE INDEX IF NOT EXISTS lessons_subject_status_idx ON lessons(subject, status, updated_at DESC)`,
			`CREATE TABLE IF NOT EXISTS lesson_versions (
				lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
				version INTEGER NOT NULL,
				schema_version INTEGER NOT NULL DEFAULT 1,
				document_json TEXT NOT NULL,
				created_at TEXT NOT NULL,
				PRIMARY KEY (lesson_id, version)
			)`,
			`CREATE INDEX IF NOT EXISTS lesson_versions_created_idx ON lesson_versions(lesson_id, created_at DESC)`,
		}
		for _, statement := range statements {
			if _, err := tx.ExecContext(ctx, statement); err != nil {
				return fmt.Errorf("apply schema version %d: %w", version, err)
			}
		}
	case 13:
		statements := []string{
			`CREATE TABLE IF NOT EXISTS lesson_links (
				lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
				target_type TEXT NOT NULL CHECK (target_type IN ('knowledge_item', 'prompt')),
				target_id TEXT NOT NULL,
				created_at TEXT NOT NULL,
				PRIMARY KEY (lesson_id, target_type, target_id)
			)`,
			`CREATE INDEX IF NOT EXISTS lesson_links_target_idx ON lesson_links(target_type, target_id, lesson_id)`,
		}
		for _, statement := range statements {
			if _, err := tx.ExecContext(ctx, statement); err != nil {
				return fmt.Errorf("apply schema version %d: %w", version, err)
			}
		}
	default:
		return fmt.Errorf("unsupported migration version %d", version)
	}
	return nil
}

func verifySchema(ctx context.Context, tx *sql.Tx, version int) error {
	switch version {
	case 2:
		if !hasColumn(ctx, tx, "import_jobs", "original_name") {
			return errors.New("schema version 2 is recorded but import_jobs.original_name is missing")
		}
	case 3:
		if !hasTable(ctx, tx, "knowledge_groups") || !hasTable(ctx, tx, "knowledge_item_groups") {
			return errors.New("schema version 3 is recorded but group tables are missing")
		}
		if !hasColumn(ctx, tx, "audio_assets", "provider") {
			return errors.New("schema version 3 is recorded but audio_assets.provider is missing")
		}
	case 4:
		if !hasColumn(ctx, tx, "knowledge_items", "subject") {
			return errors.New("schema version 4 is recorded but knowledge_items.subject is missing")
		}
	case 5:
		if !hasTable(ctx, tx, "chat_messages") {
			return errors.New("schema version 5 is recorded but chat_messages is missing")
		}
	case 6:
		if !hasTable(ctx, tx, "integrated_notes") {
			return errors.New("schema version 6 is recorded but integrated_notes is missing")
		}
	case 7:
		if !hasTable(ctx, tx, "chat_attachments") {
			return errors.New("schema version 7 is recorded but chat_attachments is missing")
		}
	case 8:
		if !hasTable(ctx, tx, "questions") || !hasTable(ctx, tx, "question_attempts") {
			return errors.New("schema version 8 is recorded but the question tables are missing")
		}
	case 9:
		if !hasColumn(ctx, tx, "questions", "knowledge_item_id") {
			return errors.New("schema version 9 is recorded but questions.knowledge_item_id is missing")
		}
	case 10:
		if !hasTable(ctx, tx, "voice_roles") {
			return errors.New("schema version 10 is recorded but voice_roles is missing")
		}
	case 11:
		if !hasTable(ctx, tx, "english_articles") {
			return errors.New("schema version 11 is recorded but english_articles is missing")
		}
	case 12:
		if !hasTable(ctx, tx, "lessons") || !hasTable(ctx, tx, "lesson_versions") {
			return errors.New("schema version 12 is recorded but lesson tables are missing")
		}
	case 13:
		if !hasTable(ctx, tx, "lesson_links") {
			return errors.New("schema version 13 is recorded but lesson_links is missing")
		}
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

func hasTable(ctx context.Context, tx *sql.Tx, table string) bool {
	var count int
	if err := tx.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?`, table).Scan(&count); err != nil {
		return false
	}
	return count > 0
}
