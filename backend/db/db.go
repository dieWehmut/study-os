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

const currentSchemaVersion = 18

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
	if err := ensureDefaultErrorCauses(ctx, tx); err != nil {
		return err
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
	case 14:
		statements := []string{
			`CREATE TABLE IF NOT EXISTS lesson_attempts (
				id TEXT PRIMARY KEY,
				lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
				section_id TEXT NOT NULL,
				answer TEXT NOT NULL,
				evaluation TEXT NOT NULL CHECK (evaluation IN ('correct', 'incorrect', 'ungraded')),
				reference_answer TEXT NOT NULL DEFAULT '',
				feedback TEXT NOT NULL DEFAULT '',
				elapsed_ms INTEGER NOT NULL DEFAULT 0 CHECK (elapsed_ms >= 0),
				created_at TEXT NOT NULL
			)`,
			`CREATE INDEX IF NOT EXISTS lesson_attempts_lesson_section_idx
				ON lesson_attempts(lesson_id, section_id, created_at DESC, id DESC)`,
		}
		for _, statement := range statements {
			if _, err := tx.ExecContext(ctx, statement); err != nil {
				return fmt.Errorf("apply schema version %d: %w", version, err)
			}
		}
	case 15:
		// Some historical test/fixture databases intentionally contain only
		// the migrations under test. If the question tables do not exist yet,
		// the question feature's later migration will create them; there is
		// nothing to alter in this step.
		if !hasTable(ctx, tx, "questions") || !hasTable(ctx, tx, "question_attempts") {
			return nil
		}
		statements := []string{
			`ALTER TABLE question_attempts ADD COLUMN answer TEXT NOT NULL DEFAULT ''`,
			`ALTER TABLE question_attempts ADD COLUMN elapsed_ms INTEGER NOT NULL DEFAULT 0 CHECK (elapsed_ms >= 0)`,
			`ALTER TABLE question_attempts ADD COLUMN is_correct INTEGER NOT NULL DEFAULT 0 CHECK (is_correct IN (0, 1))`,
			`UPDATE question_attempts SET is_correct = 1 WHERE cause = '' AND is_correct = 0`,
		}
		for _, statement := range statements {
			if _, err := tx.ExecContext(ctx, statement); err != nil {
				return fmt.Errorf("apply schema version %d: %w", version, err)
			}
		}
	case 16:
		statements := []string{
			`CREATE TABLE IF NOT EXISTS error_causes (
				id TEXT PRIMARY KEY,
				subject TEXT NOT NULL DEFAULT '',
				parent_id TEXT REFERENCES error_causes(id) ON DELETE SET NULL,
				label TEXT NOT NULL,
				review_fixes INTEGER NOT NULL DEFAULT 0 CHECK (review_fixes IN (0, 1)),
				action TEXT NOT NULL DEFAULT '',
				status TEXT NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate', 'confirmed', 'archived')),
				source_type TEXT NOT NULL DEFAULT '',
				source_id TEXT NOT NULL DEFAULT '',
				sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			)`,
			`CREATE INDEX IF NOT EXISTS error_causes_scope_idx
				ON error_causes(subject, status, sort_order, id)`,
		}
		for _, statement := range statements {
			if _, err := tx.ExecContext(ctx, statement); err != nil {
				return fmt.Errorf("apply schema version %d: %w", version, err)
			}
		}
	case 17:
		statements := []string{
			`CREATE TABLE IF NOT EXISTS qa_records (
				id TEXT PRIMARY KEY,
				session_id TEXT NOT NULL,
				subject TEXT NOT NULL,
				context_type TEXT NOT NULL DEFAULT ''
					CHECK (context_type IN ('', 'knowledge_item', 'question', 'lesson')),
				context_id TEXT NOT NULL DEFAULT '',
				original_understanding TEXT NOT NULL DEFAULT '',
				corrected_model TEXT NOT NULL DEFAULT '',
				mastery_evidence TEXT NOT NULL DEFAULT '',
				unresolved TEXT NOT NULL DEFAULT '',
				status TEXT NOT NULL CHECK (status IN ('open', 'understood', 'follow_up')),
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				CHECK ((context_type = '' AND context_id = '') OR (context_type <> '' AND context_id <> ''))
			)`,
			`CREATE UNIQUE INDEX IF NOT EXISTS qa_records_session_idx ON qa_records(session_id)`,
		}
		for _, statement := range statements {
			if _, err := tx.ExecContext(ctx, statement); err != nil {
				return fmt.Errorf("apply schema version %d: %w", version, err)
			}
		}
	case 18:
		hasQuestions := hasTable(ctx, tx, "questions")
		hasAttempts := hasTable(ctx, tx, "question_attempts")
		if hasQuestions != hasAttempts {
			return errors.New("schema version 18 requires questions and question_attempts together")
		}
		if !hasAttempts {
			return nil
		}
		if !hasColumn(ctx, tx, "question_attempts", "evidence_json") {
			if _, err := tx.ExecContext(ctx, `ALTER TABLE question_attempts ADD COLUMN evidence_json TEXT NOT NULL DEFAULT '{}'`); err != nil {
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
		if !hasTable(ctx, tx, "lessons") || !hasTable(ctx, tx, "lesson_versions") || !hasTable(ctx, tx, "lesson_links") {
			return errors.New("schema version 13 is recorded but lesson tables or lesson_links are missing")
		}
	case 14:
		if !hasTable(ctx, tx, "lessons") || !hasTable(ctx, tx, "lesson_versions") ||
			!hasTable(ctx, tx, "lesson_links") || !hasTable(ctx, tx, "lesson_attempts") {
			return errors.New("schema version 14 is recorded but lesson dependencies are missing")
		}
	case 15:
		// Keep the dependency diagnostic from v14 stable for partial legacy
		// fixtures, then validate evidence when the question tables exist.
		if !hasTable(ctx, tx, "lessons") || !hasTable(ctx, tx, "lesson_versions") ||
			!hasTable(ctx, tx, "lesson_links") || !hasTable(ctx, tx, "lesson_attempts") {
			return errors.New("schema version 14 is recorded but lesson dependencies are missing")
		}
		if hasTable(ctx, tx, "questions") && hasTable(ctx, tx, "question_attempts") &&
			(!hasColumn(ctx, tx, "question_attempts", "answer") ||
				!hasColumn(ctx, tx, "question_attempts", "elapsed_ms") ||
				!hasColumn(ctx, tx, "question_attempts", "is_correct")) {
			return errors.New("schema version 15 is recorded but question attempt evidence is missing")
		}
	case 16:
		if !hasTable(ctx, tx, "lessons") || !hasTable(ctx, tx, "lesson_versions") ||
			!hasTable(ctx, tx, "lesson_links") || !hasTable(ctx, tx, "lesson_attempts") {
			return errors.New("schema version 14 is recorded but lesson dependencies are missing")
		}
		if hasTable(ctx, tx, "questions") && hasTable(ctx, tx, "question_attempts") &&
			(!hasColumn(ctx, tx, "question_attempts", "answer") ||
				!hasColumn(ctx, tx, "question_attempts", "elapsed_ms") ||
				!hasColumn(ctx, tx, "question_attempts", "is_correct")) {
			return errors.New("schema version 15 is recorded but question attempt evidence is missing")
		}
		if !hasTable(ctx, tx, "error_causes") {
			return errors.New("schema version 16 is recorded but error_causes is missing")
		}
	case 17:
		if err := verifySchema(ctx, tx, 16); err != nil {
			return err
		}
		if !hasTable(ctx, tx, "qa_records") {
			return errors.New("schema version 17 is recorded but qa_records is missing")
		}
		for _, column := range []string{
			"id", "session_id", "subject", "context_type", "context_id",
			"original_understanding", "corrected_model", "mastery_evidence",
			"unresolved", "status", "created_at", "updated_at",
		} {
			if !hasColumn(ctx, tx, "qa_records", column) {
				return fmt.Errorf("schema version 17 is recorded but qa_records.%s is missing", column)
			}
		}
		if !hasUniqueIndexOnColumn(ctx, tx, "qa_records", "qa_records_session_idx", "session_id") {
			return errors.New("schema version 17 is recorded but qa_records_session_idx is missing or invalid")
		}
	case 18:
		if err := verifySchema(ctx, tx, 17); err != nil {
			return err
		}
		hasQuestions := hasTable(ctx, tx, "questions")
		hasAttempts := hasTable(ctx, tx, "question_attempts")
		if hasQuestions != hasAttempts {
			return errors.New("schema version 18 is recorded but question tables are incomplete")
		}
		if hasAttempts && !hasColumn(ctx, tx, "question_attempts", "evidence_json") {
			return errors.New("schema version 18 is recorded but question_attempts.evidence_json is missing")
		}
	}
	return nil
}

func ensureDefaultErrorCauses(ctx context.Context, tx *sql.Tx) error {
	if !hasTable(ctx, tx, "error_causes") {
		return errors.New("seed default error causes: error_causes is missing")
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT OR IGNORE INTO error_causes(
			id, subject, parent_id, label, review_fixes, action, status,
			source_type, source_id, sort_order, created_at, updated_at
		) VALUES
			('recall', '', NULL, '想不起来', 1, '回到记忆检测，让它排进复习队列', 'confirmed', '', '', 0,
				strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
			('misread', '', NULL, '看错题', 0, '读题时先圈出条件和问的是什么，再动笔', 'confirmed', '', '', 1,
				strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
			('careless', '', NULL, '算错 / 手滑', 0, '留出检查这一步的时间，别靠再记一遍', 'confirmed', '', '', 2,
				strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
			('method', '', NULL, '思路不对', 0, '补的是方法，不是这道题：找同类题再做两道', 'confirmed', '', '', 3,
				strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
			('time', '', NULL, '没时间做', 0, '问题在配速，不在这道题本身', 'confirmed', '', '', 4,
				strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
			('unknown', '', NULL, '还没想清楚', 0, '先记下来，等想清楚再归类', 'confirmed', '', '', 5,
				strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
	`); err != nil {
		return fmt.Errorf("seed default error causes: %w", err)
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

func hasUniqueIndexOnColumn(ctx context.Context, tx *sql.Tx, table, index, column string) bool {
	rows, err := tx.QueryContext(ctx, `PRAGMA index_list(`+table+`)`)
	if err != nil {
		return false
	}
	defer rows.Close()
	foundUnique := false
	for rows.Next() {
		var sequence, unique, partial int
		var name, origin string
		if err := rows.Scan(&sequence, &name, &unique, &origin, &partial); err != nil {
			return false
		}
		if name == index && unique == 1 {
			foundUnique = true
			break
		}
	}
	if !foundUnique {
		return false
	}
	indexRows, err := tx.QueryContext(ctx, `PRAGMA index_info(`+index+`)`)
	if err != nil {
		return false
	}
	defer indexRows.Close()
	columns := make([]string, 0, 1)
	for indexRows.Next() {
		var sequence, cid int
		var name string
		if err := indexRows.Scan(&sequence, &cid, &name); err != nil {
			return false
		}
		columns = append(columns, name)
	}
	return len(columns) == 1 && columns[0] == column
}
