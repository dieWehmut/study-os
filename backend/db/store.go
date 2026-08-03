package db

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"study-os/backend/models"
)

var ErrNotFound = errors.New("record not found")

type Store struct {
	db *sql.DB
}

type TxStore struct {
	tx *sql.Tx
}

type queryer interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func NewStore(database *sql.DB) *Store {
	return &Store{db: database}
}

func (s *Store) SQL() *sql.DB { return s.db }

func (s *Store) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

func (s *Store) WithTx(ctx context.Context, operation func(*TxStore) error) error {
	if operation == nil {
		return errors.New("transaction operation is nil")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := operation(&TxStore{tx: tx}); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit transaction: %w", err)
	}
	return nil
}

func (s *Store) SetSetting(ctx context.Context, key, value string) error {
	return setSetting(ctx, s.db, key, value)
}

func (s *TxStore) SetSetting(ctx context.Context, key, value string) error {
	return setSetting(ctx, s.tx, key, value)
}

func setSetting(ctx context.Context, database queryer, key, value string) error {
	if strings.TrimSpace(key) == "" {
		return errors.New("setting key is empty")
	}
	_, err := database.ExecContext(ctx, `
		INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
		key, value, formatTime(time.Now().UTC()))
	if err != nil {
		return fmt.Errorf("set setting %q: %w", key, err)
	}
	return nil
}

func (s *Store) GetSetting(ctx context.Context, key string) (string, error) {
	var value string
	if err := s.db.QueryRowContext(ctx, `SELECT value FROM settings WHERE key = ?`, key).Scan(&value); err != nil {
		return "", mapNotFound(err, "setting")
	}
	return value, nil
}

func (s *Store) CreateKnowledgeItem(ctx context.Context, item models.KnowledgeItem) error {
	return createKnowledgeItem(ctx, s.db, item)
}

func (s *TxStore) CreateKnowledgeItem(ctx context.Context, item models.KnowledgeItem) error {
	return createKnowledgeItem(ctx, s.tx, item)
}

func createKnowledgeItem(ctx context.Context, database queryer, item models.KnowledgeItem) error {
	if strings.TrimSpace(item.ID) == "" || strings.TrimSpace(item.ItemType) == "" || strings.TrimSpace(item.Term) == "" {
		return errors.New("knowledge item id, type, and term are required")
	}
	createdAt, updatedAt := normalizedTimes(item.CreatedAt, item.UpdatedAt)
	tags, err := marshalJSON(item.Tags, []string{})
	if err != nil {
		return fmt.Errorf("encode knowledge tags: %w", err)
	}
	_, err = database.ExecContext(ctx, `
		INSERT INTO knowledge_items(
			id, source_id, item_type, term, part_of_speech, pronunciation,
			concise_definition, detailed_markdown, example, level, tags_json,
			fingerprint, created_at, updated_at
		) VALUES (?, NULLIF(?, ''), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		item.ID, item.SourceID, item.ItemType, item.Term, item.PartOfSpeech,
		item.Pronunciation, item.ConciseDefinition, item.DetailedMarkdown,
		item.Example, item.Level, tags, item.Fingerprint, formatTime(createdAt), formatTime(updatedAt))
	if err != nil {
		return fmt.Errorf("create knowledge item %q: %w", item.ID, err)
	}
	return nil
}

func (s *Store) GetKnowledgeItem(ctx context.Context, id string) (models.KnowledgeItem, error) {
	row := s.db.QueryRowContext(ctx, knowledgeSelect+` WHERE id = ?`, id)
	item, err := scanKnowledgeItem(row)
	if err != nil {
		return models.KnowledgeItem{}, mapNotFound(err, "knowledge item")
	}
	return item, nil
}

func (s *Store) UpdateKnowledgeItem(ctx context.Context, item models.KnowledgeItem) error {
	return updateKnowledgeItem(ctx, s.db, item)
}

func (s *TxStore) UpdateKnowledgeItem(ctx context.Context, item models.KnowledgeItem) error {
	return updateKnowledgeItem(ctx, s.tx, item)
}

func updateKnowledgeItem(ctx context.Context, database queryer, item models.KnowledgeItem) error {
	if strings.TrimSpace(item.ID) == "" {
		return errors.New("knowledge item id is empty")
	}
	_, updatedAt := normalizedTimes(item.CreatedAt, item.UpdatedAt)
	tags, err := marshalJSON(item.Tags, []string{})
	if err != nil {
		return fmt.Errorf("encode knowledge tags: %w", err)
	}
	result, err := database.ExecContext(ctx, `
		UPDATE knowledge_items SET
			item_type = ?, term = ?, part_of_speech = ?, pronunciation = ?,
			concise_definition = ?, detailed_markdown = ?, example = ?,
			level = ?, tags_json = ?, fingerprint = ?, updated_at = ?
		WHERE id = ?`,
		item.ItemType, item.Term, item.PartOfSpeech, item.Pronunciation,
		item.ConciseDefinition, item.DetailedMarkdown, item.Example,
		item.Level, tags, item.Fingerprint, formatTime(updatedAt), item.ID)
	if err != nil {
		return err
	}
	return requireChanged(result, "knowledge item")
}

func (s *Store) ListKnowledgeItems(ctx context.Context, options models.KnowledgeListOptions) ([]models.KnowledgeItem, error) {
	limit := options.Limit
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	offset := options.Offset
	if offset < 0 {
		offset = 0
	}
	query := knowledgeSelect
	arguments := make([]any, 0, 4)
	if strings.TrimSpace(options.Query) != "" {
		query += ` WHERE term LIKE ? ESCAPE '\' OR concise_definition LIKE ? ESCAPE '\'`
		pattern := "%" + escapeLike(strings.TrimSpace(options.Query)) + "%"
		arguments = append(arguments, pattern, pattern)
	}
	query += ` ORDER BY updated_at DESC, id ASC LIMIT ? OFFSET ?`
	arguments = append(arguments, limit, offset)
	rows, err := s.db.QueryContext(ctx, query, arguments...)
	if err != nil {
		return nil, fmt.Errorf("list knowledge items: %w", err)
	}
	defer rows.Close()
	items := make([]models.KnowledgeItem, 0)
	for rows.Next() {
		item, scanErr := scanKnowledgeItem(rows)
		if scanErr != nil {
			return nil, fmt.Errorf("scan knowledge item: %w", scanErr)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate knowledge items: %w", err)
	}
	return items, nil
}

// ListKnowledgeItemsForDedup returns only the fields needed to compare an
// incoming candidate. It intentionally has no UI page limit: imports must not
// silently miss a duplicate after the first page of the knowledge library.
func (s *Store) ListKnowledgeItemsForDedup(ctx context.Context) ([]models.KnowledgeItem, error) {
	return listKnowledgeItemsForDedup(ctx, s.db)
}

func (s *TxStore) ListKnowledgeItemsForDedup(ctx context.Context) ([]models.KnowledgeItem, error) {
	return listKnowledgeItemsForDedup(ctx, s.tx)
}

func listKnowledgeItemsForDedup(ctx context.Context, database queryer) ([]models.KnowledgeItem, error) {
	rows, err := database.QueryContext(ctx, `
		SELECT id, item_type, term, part_of_speech, concise_definition, fingerprint
		FROM knowledge_items ORDER BY id ASC`)
	if err != nil {
		return nil, fmt.Errorf("list knowledge items for dedup: %w", err)
	}
	defer rows.Close()
	items := make([]models.KnowledgeItem, 0)
	for rows.Next() {
		var item models.KnowledgeItem
		if err := rows.Scan(&item.ID, &item.ItemType, &item.Term, &item.PartOfSpeech, &item.ConciseDefinition, &item.Fingerprint); err != nil {
			return nil, fmt.Errorf("scan knowledge item for dedup: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate knowledge items for dedup: %w", err)
	}
	return items, nil
}

func (s *Store) CreatePrompt(ctx context.Context, prompt models.Prompt) error {
	return createPrompt(ctx, s.db, prompt)
}

func (s *TxStore) CreatePrompt(ctx context.Context, prompt models.Prompt) error {
	return createPrompt(ctx, s.tx, prompt)
}

func createPrompt(ctx context.Context, database queryer, prompt models.Prompt) error {
	if strings.TrimSpace(prompt.ID) == "" || strings.TrimSpace(prompt.KnowledgeItemID) == "" || strings.TrimSpace(prompt.PromptType) == "" {
		return errors.New("prompt id, knowledge item id, and type are required")
	}
	createdAt, updatedAt := normalizedTimes(prompt.CreatedAt, prompt.UpdatedAt)
	answers, err := marshalJSON(prompt.AcceptedAnswers, []string{})
	if err != nil {
		return fmt.Errorf("encode accepted answers: %w", err)
	}
	_, err = database.ExecContext(ctx, `
		INSERT INTO prompts(id, knowledge_item_id, prompt_type, question, accepted_answers_json, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)`, prompt.ID, prompt.KnowledgeItemID, prompt.PromptType,
		prompt.Question, answers, formatTime(createdAt), formatTime(updatedAt))
	if err != nil {
		return fmt.Errorf("create prompt %q: %w", prompt.ID, err)
	}
	return nil
}

func (s *Store) GetPrompt(ctx context.Context, id string) (models.Prompt, error) {
	row := s.db.QueryRowContext(ctx, promptSelect+` WHERE id = ?`, id)
	prompt, err := scanPrompt(row)
	if err != nil {
		return models.Prompt{}, mapNotFound(err, "prompt")
	}
	return prompt, nil
}

func (s *Store) DuePrompts(ctx context.Context, before time.Time, limit int) ([]models.Prompt, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := s.db.QueryContext(ctx, promptSelect+`
		JOIN review_states AS rs ON rs.prompt_id = p.id
		WHERE rs.due_at <= ?
		ORDER BY rs.due_at ASC, p.id ASC LIMIT ?`, formatTime(before), limit)
	if err != nil {
		return nil, fmt.Errorf("list due prompts: %w", err)
	}
	defer rows.Close()
	prompts := make([]models.Prompt, 0)
	for rows.Next() {
		prompt, scanErr := scanPrompt(rows)
		if scanErr != nil {
			return nil, fmt.Errorf("scan due prompt: %w", scanErr)
		}
		prompts = append(prompts, prompt)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate due prompts: %w", err)
	}
	return prompts, nil
}

func (s *Store) UpsertReviewState(ctx context.Context, state models.ReviewState) error {
	return upsertReviewState(ctx, s.db, state)
}

func (s *TxStore) UpsertReviewState(ctx context.Context, state models.ReviewState) error {
	return upsertReviewState(ctx, s.tx, state)
}

func upsertReviewState(ctx context.Context, database queryer, state models.ReviewState) error {
	if strings.TrimSpace(state.PromptID) == "" || len(state.CardJSON) == 0 || state.DueAt.IsZero() {
		return errors.New("review state prompt, card, and due time are required")
	}
	updatedAt := state.UpdatedAt.UTC()
	if updatedAt.IsZero() {
		updatedAt = time.Now().UTC()
	}
	_, err := database.ExecContext(ctx, `
		INSERT INTO review_states(prompt_id, card_json, due_at, updated_at) VALUES (?, ?, ?, ?)
		ON CONFLICT(prompt_id) DO UPDATE SET card_json = excluded.card_json,
			due_at = excluded.due_at, updated_at = excluded.updated_at`,
		state.PromptID, string(state.CardJSON), formatTime(state.DueAt), formatTime(updatedAt))
	if err != nil {
		return fmt.Errorf("upsert review state for %q: %w", state.PromptID, err)
	}
	return nil
}

func (s *Store) GetReviewState(ctx context.Context, promptID string) (models.ReviewState, error) {
	var state models.ReviewState
	var card, dueAt, updatedAt string
	err := s.db.QueryRowContext(ctx, `SELECT prompt_id, card_json, due_at, updated_at FROM review_states WHERE prompt_id = ?`, promptID).
		Scan(&state.PromptID, &card, &dueAt, &updatedAt)
	if err != nil {
		return models.ReviewState{}, mapNotFound(err, "review state")
	}
	state.CardJSON = json.RawMessage(card)
	if state.DueAt, err = parseTime(dueAt); err != nil {
		return models.ReviewState{}, fmt.Errorf("parse review due time: %w", err)
	}
	if state.UpdatedAt, err = parseTime(updatedAt); err != nil {
		return models.ReviewState{}, fmt.Errorf("parse review updated time: %w", err)
	}
	return state, nil
}

func (s *Store) CreateAttempt(ctx context.Context, attempt models.Attempt) error {
	return createAttempt(ctx, s.db, attempt)
}

func (s *TxStore) CreateAttempt(ctx context.Context, attempt models.Attempt) error {
	return createAttempt(ctx, s.tx, attempt)
}

func createAttempt(ctx context.Context, database queryer, attempt models.Attempt) error {
	createdAt, updatedAt := normalizedTimes(attempt.CreatedAt, attempt.UpdatedAt)
	_, err := database.ExecContext(ctx, `
		INSERT INTO attempts(id, prompt_id, study_session_id, answer, original_evaluation,
			effective_evaluation, feedback, scheduler_rating, prior_card_json, familiarity,
			created_at, updated_at)
		VALUES (?, ?, NULLIF(?, ''), ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		attempt.ID, attempt.PromptID, attempt.StudySessionID, attempt.Answer,
		attempt.OriginalEvaluation, attempt.EffectiveEvaluation, attempt.Feedback,
		attempt.SchedulerRating, string(attempt.PriorCardJSON), nullableInt(attempt.Familiarity),
		formatTime(createdAt), formatTime(updatedAt))
	if err != nil {
		return fmt.Errorf("create attempt %q: %w", attempt.ID, err)
	}
	return nil
}

func (s *Store) UpdateAttempt(ctx context.Context, attempt models.Attempt) error {
	return updateAttempt(ctx, s.db, attempt)
}

func (s *TxStore) UpdateAttempt(ctx context.Context, attempt models.Attempt) error {
	return updateAttempt(ctx, s.tx, attempt)
}

func updateAttempt(ctx context.Context, database queryer, attempt models.Attempt) error {
	updatedAt := attempt.UpdatedAt.UTC()
	if updatedAt.IsZero() {
		updatedAt = time.Now().UTC()
	}
	result, err := database.ExecContext(ctx, `
		UPDATE attempts SET effective_evaluation = ?, feedback = ?, scheduler_rating = ?,
			familiarity = ?, updated_at = ? WHERE id = ?`,
		attempt.EffectiveEvaluation, attempt.Feedback, attempt.SchedulerRating,
		nullableInt(attempt.Familiarity), formatTime(updatedAt), attempt.ID)
	if err != nil {
		return fmt.Errorf("update attempt %q: %w", attempt.ID, err)
	}
	return requireChanged(result, "attempt")
}

func (s *Store) GetAttempt(ctx context.Context, id string) (models.Attempt, error) {
	var attempt models.Attempt
	var sessionID sql.NullString
	var priorCard, createdAt, updatedAt string
	var familiarity sql.NullInt64
	err := s.db.QueryRowContext(ctx, `
		SELECT id, prompt_id, study_session_id, answer, original_evaluation,
			effective_evaluation, feedback, scheduler_rating, prior_card_json,
			familiarity, created_at, updated_at FROM attempts WHERE id = ?`, id).
		Scan(&attempt.ID, &attempt.PromptID, &sessionID, &attempt.Answer,
			&attempt.OriginalEvaluation, &attempt.EffectiveEvaluation, &attempt.Feedback,
			&attempt.SchedulerRating, &priorCard, &familiarity, &createdAt, &updatedAt)
	if err != nil {
		return models.Attempt{}, mapNotFound(err, "attempt")
	}
	attempt.StudySessionID = sessionID.String
	attempt.PriorCardJSON = json.RawMessage(priorCard)
	if familiarity.Valid {
		value := int(familiarity.Int64)
		attempt.Familiarity = &value
	}
	if attempt.CreatedAt, err = parseTime(createdAt); err != nil {
		return models.Attempt{}, fmt.Errorf("parse attempt created time: %w", err)
	}
	if attempt.UpdatedAt, err = parseTime(updatedAt); err != nil {
		return models.Attempt{}, fmt.Errorf("parse attempt updated time: %w", err)
	}
	return attempt, nil
}

func (s *Store) CreateAgentJob(ctx context.Context, job models.AgentJob) error {
	return createAgentJob(ctx, s.db, job)
}

func (s *TxStore) CreateAgentJob(ctx context.Context, job models.AgentJob) error {
	return createAgentJob(ctx, s.tx, job)
}

func createAgentJob(ctx context.Context, database queryer, job models.AgentJob) error {
	createdAt, updatedAt := normalizedTimes(job.CreatedAt, job.UpdatedAt)
	_, err := database.ExecContext(ctx, `
		INSERT INTO agent_jobs(id, job_type, provider, state, payload_json, attempts,
			error_summary, next_retry_at, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, job.ID, job.JobType, job.Provider,
		job.State, string(job.PayloadJSON), job.Attempts, job.ErrorSummary,
		nullableTime(job.NextRetryAt), formatTime(createdAt), formatTime(updatedAt))
	if err != nil {
		return fmt.Errorf("create agent job %q: %w", job.ID, err)
	}
	return nil
}

func (s *Store) UpdateAgentJob(ctx context.Context, job models.AgentJob) error {
	updatedAt := job.UpdatedAt.UTC()
	if updatedAt.IsZero() {
		updatedAt = time.Now().UTC()
	}
	result, err := s.db.ExecContext(ctx, `
		UPDATE agent_jobs SET state = ?, attempts = ?, error_summary = ?,
			next_retry_at = ?, updated_at = ? WHERE id = ?`, job.State, job.Attempts,
		job.ErrorSummary, nullableTime(job.NextRetryAt), formatTime(updatedAt), job.ID)
	if err != nil {
		return fmt.Errorf("update agent job %q: %w", job.ID, err)
	}
	return requireChanged(result, "agent job")
}

func (s *Store) GetAgentJob(ctx context.Context, id string) (models.AgentJob, error) {
	var job models.AgentJob
	var payload, createdAt, updatedAt string
	var nextRetry sql.NullString
	err := s.db.QueryRowContext(ctx, `
		SELECT id, job_type, provider, state, payload_json, attempts, error_summary,
			next_retry_at, created_at, updated_at FROM agent_jobs WHERE id = ?`, id).
		Scan(&job.ID, &job.JobType, &job.Provider, &job.State, &payload, &job.Attempts,
			&job.ErrorSummary, &nextRetry, &createdAt, &updatedAt)
	if err != nil {
		return models.AgentJob{}, mapNotFound(err, "agent job")
	}
	job.PayloadJSON = json.RawMessage(payload)
	if nextRetry.Valid {
		if job.NextRetryAt, err = parseTime(nextRetry.String); err != nil {
			return models.AgentJob{}, fmt.Errorf("parse agent next retry time: %w", err)
		}
	}
	if job.CreatedAt, err = parseTime(createdAt); err != nil {
		return models.AgentJob{}, fmt.Errorf("parse agent created time: %w", err)
	}
	if job.UpdatedAt, err = parseTime(updatedAt); err != nil {
		return models.AgentJob{}, fmt.Errorf("parse agent updated time: %w", err)
	}
	return job, nil
}

func (s *Store) AppendDomainEvent(ctx context.Context, event models.DomainEvent) error {
	return appendDomainEvent(ctx, s.db, event)
}

func (s *TxStore) AppendDomainEvent(ctx context.Context, event models.DomainEvent) error {
	return appendDomainEvent(ctx, s.tx, event)
}

func (s *Store) CreateBackupRecord(ctx context.Context, record models.BackupRecord) error {
	return createBackupRecord(ctx, s.db, record)
}

func (s *TxStore) CreateBackupRecord(ctx context.Context, record models.BackupRecord) error {
	return createBackupRecord(ctx, s.tx, record)
}

func createBackupRecord(ctx context.Context, database queryer, record models.BackupRecord) error {
	createdAt := record.CreatedAt.UTC()
	if createdAt.IsZero() {
		createdAt = time.Now().UTC()
	}
	if strings.TrimSpace(record.ID) == "" || strings.TrimSpace(record.Category) == "" || strings.TrimSpace(record.Path) == "" || strings.TrimSpace(record.SHA256) == "" {
		return errors.New("backup record id, category, path, and checksum are required")
	}
	_, err := database.ExecContext(ctx, `
		INSERT INTO backup_records(id, category, path, sha256, size_bytes, created_at)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			category = excluded.category,
			path = excluded.path,
			sha256 = excluded.sha256,
			size_bytes = excluded.size_bytes,
			created_at = excluded.created_at`, record.ID, record.Category, record.Path, record.SHA256, record.SizeBytes, formatTime(createdAt))
	if err != nil {
		return fmt.Errorf("create backup record %q: %w", record.ID, err)
	}
	return nil
}

func (s *Store) ListBackupRecords(ctx context.Context, limit int) ([]models.BackupRecord, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, category, path, sha256, size_bytes, created_at
		FROM backup_records ORDER BY created_at DESC, id DESC LIMIT ?`, limit)
	if err != nil {
		return nil, fmt.Errorf("list backup records: %w", err)
	}
	defer rows.Close()
	records := make([]models.BackupRecord, 0)
	for rows.Next() {
		var record models.BackupRecord
		var createdAt string
		if err := rows.Scan(&record.ID, &record.Category, &record.Path, &record.SHA256, &record.SizeBytes, &createdAt); err != nil {
			return nil, fmt.Errorf("scan backup record: %w", err)
		}
		if record.CreatedAt, err = parseTime(createdAt); err != nil {
			return nil, fmt.Errorf("parse backup record time: %w", err)
		}
		records = append(records, record)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate backup records: %w", err)
	}
	return records, nil
}

// ReconcileBackupRecords removes metadata for backup files that retention or
// an external cleanup has already removed, and returns the number of live
// records. Paths are server-owned values written by RecordBackup.
func (s *Store) ReconcileBackupRecords(ctx context.Context) (int, error) {
	records, err := s.listAllBackupRecords(ctx)
	if err != nil {
		return 0, err
	}
	live := 0
	for _, record := range records {
		info, statErr := os.Lstat(record.Path)
		if statErr == nil {
			if info.Mode().IsRegular() && info.Mode()&os.ModeSymlink == 0 {
				live++
				continue
			}
		} else if !errors.Is(statErr, os.ErrNotExist) {
			return 0, fmt.Errorf("inspect backup record %q: %w", record.ID, statErr)
		}
		if _, deleteErr := s.db.ExecContext(ctx, `DELETE FROM backup_records WHERE id = ?`, record.ID); deleteErr != nil {
			return 0, fmt.Errorf("delete stale backup record %q: %w", record.ID, deleteErr)
		}
	}
	return live, nil
}

func (s *Store) listAllBackupRecords(ctx context.Context) ([]models.BackupRecord, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, category, path, sha256, size_bytes, created_at
		FROM backup_records ORDER BY created_at DESC, id DESC`)
	if err != nil {
		return nil, fmt.Errorf("list all backup records: %w", err)
	}
	defer rows.Close()
	records := make([]models.BackupRecord, 0)
	for rows.Next() {
		var record models.BackupRecord
		var createdAt string
		if err := rows.Scan(&record.ID, &record.Category, &record.Path, &record.SHA256, &record.SizeBytes, &createdAt); err != nil {
			return nil, fmt.Errorf("scan backup record: %w", err)
		}
		if record.CreatedAt, err = parseTime(createdAt); err != nil {
			return nil, fmt.Errorf("parse backup record time: %w", err)
		}
		records = append(records, record)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate backup records: %w", err)
	}
	return records, nil
}

func appendDomainEvent(ctx context.Context, database queryer, event models.DomainEvent) error {
	occurredAt := event.OccurredAt.UTC()
	if occurredAt.IsZero() {
		occurredAt = time.Now().UTC()
	}
	payload := event.PayloadJSON
	if len(payload) == 0 {
		payload = json.RawMessage(`{}`)
	}
	_, err := database.ExecContext(ctx, `
		INSERT INTO domain_events(id, event_type, aggregate_id, payload_json, occurred_at)
		VALUES (?, ?, ?, ?, ?)`, event.ID, event.EventType, event.AggregateID,
		string(payload), formatTime(occurredAt))
	if err != nil {
		return fmt.Errorf("append domain event %q: %w", event.ID, err)
	}
	return nil
}

func (s *Store) ListDomainEvents(ctx context.Context, limit int) ([]models.DomainEvent, error) {
	if limit <= 0 || limit > 1000 {
		limit = 100
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, event_type, aggregate_id, payload_json, occurred_at
		FROM domain_events ORDER BY occurred_at DESC, id DESC LIMIT ?`, limit)
	if err != nil {
		return nil, fmt.Errorf("list domain events: %w", err)
	}
	defer rows.Close()
	events := make([]models.DomainEvent, 0)
	for rows.Next() {
		var event models.DomainEvent
		var payload, occurredAt string
		if err := rows.Scan(&event.ID, &event.EventType, &event.AggregateID, &payload, &occurredAt); err != nil {
			return nil, fmt.Errorf("scan domain event: %w", err)
		}
		event.PayloadJSON = json.RawMessage(payload)
		if event.OccurredAt, err = parseTime(occurredAt); err != nil {
			return nil, fmt.Errorf("parse domain event time: %w", err)
		}
		events = append(events, event)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate domain events: %w", err)
	}
	return events, nil
}

func (s *Store) seedFixtures(ctx context.Context) error {
	const fixtureID = "fixture-knowledge-abandon"
	if _, err := s.GetKnowledgeItem(ctx, fixtureID); err == nil {
		return nil
	} else if !errors.Is(err, ErrNotFound) {
		return err
	}
	now := time.Now().UTC()
	return s.CreateKnowledgeItem(ctx, models.KnowledgeItem{
		ID:                fixtureID,
		ItemType:          "word_sense",
		Term:              "abandon",
		PartOfSpeech:      "verb",
		ConciseDefinition: "放弃；抛弃",
		DetailedMarkdown:  "## abandon\n\nA bundled development fixture.",
		Level:             "CET4",
		Tags:              []string{"fixture"},
		CreatedAt:         now,
		UpdatedAt:         now,
	})
}

const knowledgeSelect = `SELECT id, COALESCE(source_id, ''), item_type, term,
	part_of_speech, pronunciation, concise_definition, detailed_markdown, example,
	level, tags_json, fingerprint, created_at, updated_at FROM knowledge_items`

const promptSelect = `SELECT p.id, p.knowledge_item_id, p.prompt_type, p.question,
	p.accepted_answers_json, p.created_at, p.updated_at FROM prompts AS p`

type scanner interface {
	Scan(...any) error
}

func scanKnowledgeItem(row scanner) (models.KnowledgeItem, error) {
	var item models.KnowledgeItem
	var tags, createdAt, updatedAt string
	if err := row.Scan(&item.ID, &item.SourceID, &item.ItemType, &item.Term,
		&item.PartOfSpeech, &item.Pronunciation, &item.ConciseDefinition,
		&item.DetailedMarkdown, &item.Example, &item.Level, &tags, &item.Fingerprint,
		&createdAt, &updatedAt); err != nil {
		return models.KnowledgeItem{}, err
	}
	if err := json.Unmarshal([]byte(tags), &item.Tags); err != nil {
		return models.KnowledgeItem{}, fmt.Errorf("decode tags: %w", err)
	}
	var err error
	if item.CreatedAt, err = parseTime(createdAt); err != nil {
		return models.KnowledgeItem{}, fmt.Errorf("parse knowledge created time: %w", err)
	}
	if item.UpdatedAt, err = parseTime(updatedAt); err != nil {
		return models.KnowledgeItem{}, fmt.Errorf("parse knowledge updated time: %w", err)
	}
	return item, nil
}

func scanPrompt(row scanner) (models.Prompt, error) {
	var prompt models.Prompt
	var answers, createdAt, updatedAt string
	if err := row.Scan(&prompt.ID, &prompt.KnowledgeItemID, &prompt.PromptType,
		&prompt.Question, &answers, &createdAt, &updatedAt); err != nil {
		return models.Prompt{}, err
	}
	if err := json.Unmarshal([]byte(answers), &prompt.AcceptedAnswers); err != nil {
		return models.Prompt{}, fmt.Errorf("decode accepted answers: %w", err)
	}
	var err error
	if prompt.CreatedAt, err = parseTime(createdAt); err != nil {
		return models.Prompt{}, fmt.Errorf("parse prompt created time: %w", err)
	}
	if prompt.UpdatedAt, err = parseTime(updatedAt); err != nil {
		return models.Prompt{}, fmt.Errorf("parse prompt updated time: %w", err)
	}
	return prompt, nil
}

func marshalJSON(value any, fallback any) (string, error) {
	if value == nil {
		value = fallback
	}
	encoded, err := json.Marshal(value)
	return string(encoded), err
}

func normalizedTimes(createdAt, updatedAt time.Time) (time.Time, time.Time) {
	createdAt = createdAt.UTC()
	updatedAt = updatedAt.UTC()
	if createdAt.IsZero() {
		createdAt = time.Now().UTC()
	}
	if updatedAt.IsZero() {
		updatedAt = createdAt
	}
	return createdAt, updatedAt
}

func formatTime(value time.Time) string {
	return value.UTC().Format(time.RFC3339Nano)
}

func parseTime(value string) (time.Time, error) {
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return time.Time{}, err
	}
	return parsed.UTC(), nil
}

func nullableTime(value time.Time) any {
	if value.IsZero() {
		return nil
	}
	return formatTime(value)
}

func nullableInt(value *int) any {
	if value == nil {
		return nil
	}
	return *value
}

func mapNotFound(err error, kind string) error {
	if errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("%s: %w", kind, ErrNotFound)
	}
	return err
}

func requireChanged(result sql.Result, kind string) error {
	changed, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("inspect updated %s: %w", kind, err)
	}
	if changed == 0 {
		return fmt.Errorf("%s: %w", kind, ErrNotFound)
	}
	return nil
}

func escapeLike(value string) string {
	value = strings.ReplaceAll(value, `\`, `\\`)
	value = strings.ReplaceAll(value, `%`, `\%`)
	return strings.ReplaceAll(value, `_`, `\_`)
}
