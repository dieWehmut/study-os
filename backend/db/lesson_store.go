package db

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"study-os/backend/models"
)

// ErrLessonVersionConflict means an update was based on a stale document.
// Callers can reload the current Lesson and decide whether to merge or retry.
var ErrLessonVersionConflict = errors.New("lesson version conflict")

// ErrLessonAlreadyExists lets the HTTP layer report a deterministic conflict
// instead of leaking a driver-specific UNIQUE constraint message.
var ErrLessonAlreadyExists = errors.New("lesson already exists")

// ErrInvalidLesson identifies client-provided lesson data that failed
// validation. It lets the HTTP layer distinguish a 400 from a storage failure.
var ErrInvalidLesson = errors.New("invalid lesson")

func (s *Store) CreateLesson(ctx context.Context, lesson models.Lesson) error {
	if s == nil || s.db == nil {
		return errors.New("store is unavailable")
	}
	document, err := models.NormalizeLessonDocument(lesson.Document)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrInvalidLesson, err)
	}
	if strings.TrimSpace(lesson.ID) == "" {
		return fmt.Errorf("%w: lesson id is required", ErrInvalidLesson)
	}
	if strings.TrimSpace(lesson.Title) == "" {
		return fmt.Errorf("%w: lesson title is required", ErrInvalidLesson)
	}
	lesson.Status = strings.TrimSpace(lesson.Status)
	if lesson.Status == "" {
		lesson.Status = models.LessonStatusDraft
	}
	if !models.IsLessonStatusValid(lesson.Status) {
		return fmt.Errorf("%w: invalid lesson status %q", ErrInvalidLesson, lesson.Status)
	}
	createdAt, updatedAt := normalizedTimes(lesson.CreatedAt, lesson.UpdatedAt)
	documentJSON, err := json.Marshal(document)
	if err != nil {
		return fmt.Errorf("encode lesson document: %w", err)
	}
	return s.WithTx(ctx, func(tx *TxStore) error {
		var exists bool
		if err := tx.tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM lessons WHERE id = ?)`, strings.TrimSpace(lesson.ID)).Scan(&exists); err != nil {
			return fmt.Errorf("check lesson %q: %w", lesson.ID, err)
		}
		if exists {
			return ErrLessonAlreadyExists
		}
		if _, err := tx.tx.ExecContext(ctx, `
			INSERT INTO lessons(
				id, subject, title, source_type, source_id, status,
				current_version, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
			strings.TrimSpace(lesson.ID), strings.TrimSpace(lesson.Subject), strings.TrimSpace(lesson.Title),
			strings.TrimSpace(lesson.SourceType), strings.TrimSpace(lesson.SourceID), lesson.Status,
			formatTime(createdAt), formatTime(updatedAt)); err != nil {
			return fmt.Errorf("create lesson %q: %w", lesson.ID, err)
		}
		if _, err := tx.tx.ExecContext(ctx, `
			INSERT INTO lesson_versions(lesson_id, version, schema_version, document_json, created_at)
			VALUES (?, 1, ?, ?, ?)`,
			strings.TrimSpace(lesson.ID), document.SchemaVersion, string(documentJSON), formatTime(createdAt)); err != nil {
			return fmt.Errorf("create lesson version %q: %w", lesson.ID, err)
		}
		return nil
	})
}

// UpdateLesson writes a new immutable document version and updates the Lesson
// pointer atomically. expectedVersion <= 0 opts out of the optimistic check;
// HTTP clients should send the version they read.
func (s *Store) UpdateLesson(ctx context.Context, lesson models.Lesson, expectedVersion int) (models.Lesson, error) {
	if s == nil || s.db == nil {
		return models.Lesson{}, errors.New("store is unavailable")
	}
	if strings.TrimSpace(lesson.ID) == "" {
		return models.Lesson{}, fmt.Errorf("%w: lesson id is required", ErrInvalidLesson)
	}
	if strings.TrimSpace(lesson.Title) == "" {
		return models.Lesson{}, fmt.Errorf("%w: lesson title is required", ErrInvalidLesson)
	}
	lesson.Status = strings.TrimSpace(lesson.Status)
	if lesson.Status == "" {
		return models.Lesson{}, fmt.Errorf("%w: lesson status is required", ErrInvalidLesson)
	}
	if !models.IsLessonStatusValid(lesson.Status) {
		return models.Lesson{}, fmt.Errorf("%w: invalid lesson status %q", ErrInvalidLesson, lesson.Status)
	}
	document, err := models.NormalizeLessonDocument(lesson.Document)
	if err != nil {
		return models.Lesson{}, fmt.Errorf("%w: %v", ErrInvalidLesson, err)
	}
	documentJSON, err := json.Marshal(document)
	if err != nil {
		return models.Lesson{}, fmt.Errorf("encode lesson document: %w", err)
	}
	now := time.Now().UTC()
	err = s.WithTx(ctx, func(tx *TxStore) error {
		var current int
		if err := tx.tx.QueryRowContext(ctx, `SELECT current_version FROM lessons WHERE id = ?`, lesson.ID).Scan(&current); err != nil {
			return mapNotFound(err, "lesson")
		}
		if expectedVersion > 0 && expectedVersion != current {
			return ErrLessonVersionConflict
		}
		next := current + 1
		result, err := tx.tx.ExecContext(ctx, `
			UPDATE lessons SET subject = ?, title = ?, source_type = ?, source_id = ?,
				status = ?, current_version = ?, updated_at = ? WHERE id = ?`,
			strings.TrimSpace(lesson.Subject), strings.TrimSpace(lesson.Title),
			strings.TrimSpace(lesson.SourceType), strings.TrimSpace(lesson.SourceID),
			lesson.Status, next, formatTime(now), lesson.ID)
		if err != nil {
			return fmt.Errorf("update lesson %q: %w", lesson.ID, err)
		}
		if err := requireChanged(result, "lesson"); err != nil {
			return err
		}
		if _, err := tx.tx.ExecContext(ctx, `
			INSERT INTO lesson_versions(lesson_id, version, schema_version, document_json, created_at)
			VALUES (?, ?, ?, ?, ?)`, lesson.ID, next, document.SchemaVersion,
			string(documentJSON), formatTime(now)); err != nil {
			return fmt.Errorf("create lesson version %q: %w", lesson.ID, err)
		}
		return nil
	})
	if err != nil {
		return models.Lesson{}, err
	}
	return s.GetLesson(ctx, lesson.ID)
}

func (s *Store) GetLesson(ctx context.Context, id string) (models.Lesson, error) {
	var lesson models.Lesson
	var createdAt, updatedAt string
	var version int
	row := s.db.QueryRowContext(ctx, `
		SELECT id, subject, title, source_type, source_id, status,
			current_version, created_at, updated_at
		FROM lessons WHERE id = ?`, strings.TrimSpace(id))
	if err := row.Scan(&lesson.ID, &lesson.Subject, &lesson.Title, &lesson.SourceType,
		&lesson.SourceID, &lesson.Status, &version, &createdAt, &updatedAt); err != nil {
		return models.Lesson{}, mapNotFound(err, "lesson")
	}
	var err error
	if lesson.CreatedAt, err = parseTime(createdAt); err != nil {
		return models.Lesson{}, fmt.Errorf("parse lesson created time: %w", err)
	}
	if lesson.UpdatedAt, err = parseTime(updatedAt); err != nil {
		return models.Lesson{}, fmt.Errorf("parse lesson updated time: %w", err)
	}
	revision, err := s.GetLessonVersion(ctx, lesson.ID, version)
	if err != nil {
		return models.Lesson{}, err
	}
	lesson.CurrentVersion = revision.Version
	lesson.Document = revision.Document
	return lesson, nil
}

/**
 * The history of one lesson, newest first.
 *
 * Documents are immutable, so this is the only way back to what a lesson said
 * before it was edited -- the API promised 回滚 when the table was added and
 * nothing could read it.
 *
 * The documents themselves are decoded: a caller showing the history wants to
 * say what is in each revision, and reading every document one request at a time
 * would be the caller's problem otherwise.
 */
func (s *Store) ListLessonVersions(ctx context.Context, lessonID string) ([]models.LessonVersion, error) {
	lessonID = strings.TrimSpace(lessonID)
	if lessonID == "" {
		return nil, errors.New("lesson id is required")
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT lesson_id, version, schema_version, document_json, created_at
		FROM lesson_versions WHERE lesson_id = ? ORDER BY version DESC`, lessonID)
	if err != nil {
		return nil, fmt.Errorf("list lesson versions: %w", err)
	}
	defer rows.Close()
	revisions := make([]models.LessonVersion, 0)
	for rows.Next() {
		var revision models.LessonVersion
		var documentJSON, createdAt string
		if err := rows.Scan(&revision.LessonID, &revision.Version, &revision.SchemaVersion,
			&documentJSON, &createdAt); err != nil {
			return nil, fmt.Errorf("scan lesson version: %w", err)
		}
		if err := json.Unmarshal([]byte(documentJSON), &revision.Document); err != nil {
			return nil, fmt.Errorf("decode lesson document version %d: %w", revision.Version, err)
		}
		normalized, err := models.NormalizeLessonDocument(revision.Document)
		if err != nil {
			return nil, fmt.Errorf("validate lesson document version %d: %w", revision.Version, err)
		}
		revision.Document = normalized
		if revision.CreatedAt, err = parseTime(createdAt); err != nil {
			return nil, fmt.Errorf("parse lesson version time: %w", err)
		}
		revisions = append(revisions, revision)
	}
	return revisions, rows.Err()
}

func (s *Store) GetLessonVersion(ctx context.Context, lessonID string, version int) (models.LessonVersion, error) {
	if version <= 0 {
		return models.LessonVersion{}, errors.New("lesson version must be positive")
	}
	var revision models.LessonVersion
	var documentJSON, createdAt string
	if err := s.db.QueryRowContext(ctx, `
		SELECT lesson_id, version, schema_version, document_json, created_at
		FROM lesson_versions WHERE lesson_id = ? AND version = ?`,
		strings.TrimSpace(lessonID), version).Scan(&revision.LessonID, &revision.Version,
		&revision.SchemaVersion, &documentJSON, &createdAt); err != nil {
		return models.LessonVersion{}, mapNotFound(err, "lesson version")
	}
	if err := json.Unmarshal([]byte(documentJSON), &revision.Document); err != nil {
		return models.LessonVersion{}, fmt.Errorf("decode lesson document version %d: %w", version, err)
	}
	normalized, err := models.NormalizeLessonDocument(revision.Document)
	if err != nil {
		return models.LessonVersion{}, fmt.Errorf("validate lesson document version %d: %w", version, err)
	}
	revision.Document = normalized
	if revision.CreatedAt, err = parseTime(createdAt); err != nil {
		return models.LessonVersion{}, fmt.Errorf("parse lesson version time: %w", err)
	}
	return revision, nil
}

/**
 * The WHERE every list of lessons shares, so a page and its total cannot be
 * about different sets. `count` used to be `len(items)`, and the page prints it
 * as "N 门课程" -- with 140 courses behind a limit of 100 it read 100.
 */
func lessonFilter(options models.LessonListOptions) (string, []any) {
	where := make([]string, 0, 3)
	arguments := make([]any, 0, 4)
	if subject := strings.TrimSpace(options.Subject); subject != "" {
		where = append(where, "subject = ?")
		arguments = append(arguments, subject)
	}
	if status := strings.TrimSpace(options.Status); status != "" {
		where = append(where, "status = ?")
		arguments = append(arguments, status)
	}
	if needle := strings.TrimSpace(options.Query); needle != "" {
		where = append(where, `title LIKE ? ESCAPE '\'`)
		arguments = append(arguments, "%"+escapeLike(needle)+"%")
	}
	if len(where) == 0 {
		return "", nil
	}
	return " WHERE " + strings.Join(where, " AND "), arguments
}

// CountLessons answers how many match, not how many fit on a page.
func (s *Store) CountLessons(ctx context.Context, options models.LessonListOptions) (int, error) {
	clause, arguments := lessonFilter(options)
	var total int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM lessons`+clause, arguments...).Scan(&total); err != nil {
		return 0, fmt.Errorf("count lessons: %w", err)
	}
	return total, nil
}

func (s *Store) ListLessons(ctx context.Context, options models.LessonListOptions) ([]models.LessonSummary, error) {
	limit := options.Limit
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	offset := options.Offset
	if offset < 0 {
		offset = 0
	}
	clause, arguments := lessonFilter(options)
	query := `SELECT id, subject, title, source_type, source_id, status,
		current_version, created_at, updated_at FROM lessons` + clause
	query += " ORDER BY updated_at DESC, id ASC LIMIT ? OFFSET ?"
	arguments = append(arguments, limit, offset)
	rows, err := s.db.QueryContext(ctx, query, arguments...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]models.LessonSummary, 0)
	for rows.Next() {
		var item models.LessonSummary
		var createdAt, updatedAt string
		if err := rows.Scan(&item.ID, &item.Subject, &item.Title, &item.SourceType,
			&item.SourceID, &item.Status, &item.CurrentVersion, &createdAt, &updatedAt); err != nil {
			return nil, err
		}
		if item.CreatedAt, err = parseTime(createdAt); err != nil {
			return nil, fmt.Errorf("parse lesson created time: %w", err)
		}
		if item.UpdatedAt, err = parseTime(updatedAt); err != nil {
			return nil, fmt.Errorf("parse lesson updated time: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := s.attachPracticeQuestionCounts(ctx, items); err != nil {
		return nil, err
	}
	return items, nil
}

// attachPracticeQuestionCounts fills in how many questions each lesson asks.
//
// One query for the page, not one per lesson: the count is the reader's answer to
// "how much practice is in here", and a local app that hits its own database
// fifty times to draw one list is still fifty queries.
func (s *Store) attachPracticeQuestionCounts(ctx context.Context, items []models.LessonSummary) error {
	if len(items) == 0 {
		return nil
	}
	ids := make([]any, 0, len(items))
	placeholders := make([]string, 0, len(items))
	index := make(map[string]int, len(items))
	for position, item := range items {
		ids = append(ids, item.ID)
		placeholders = append(placeholders, "?")
		index[item.ID] = position
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT v.lesson_id, v.document_json
		FROM lesson_versions v
		JOIN lessons l ON l.id = v.lesson_id AND l.current_version = v.version
		WHERE v.lesson_id IN (`+strings.Join(placeholders, ", ")+`)`, ids...)
	if err != nil {
		return fmt.Errorf("read lesson documents for practice counts: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var lessonID, documentJSON string
		if err := rows.Scan(&lessonID, &documentJSON); err != nil {
			return fmt.Errorf("scan lesson document: %w", err)
		}
		position, ok := index[lessonID]
		if !ok {
			continue
		}
		items[position].PracticeQuestions = practiceQuestionCount(documentJSON)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate lesson documents: %w", err)
	}
	return nil
}

// practiceQuestionCount reads the 即时练习 section of a stored document.
//
// A document that will not parse counts as zero rather than failing the list: the
// reader is browsing titles, and one bad document must not empty the page.
func practiceQuestionCount(documentJSON string) int {
	var document models.LessonDocument
	if err := json.Unmarshal([]byte(documentJSON), &document); err != nil {
		return 0
	}
	for _, section := range document.Sections {
		if strings.TrimSpace(section.Type) != "practice" {
			continue
		}
		var content struct {
			Question  string            `json:"question"`
			Questions []json.RawMessage `json:"questions"`
		}
		if err := json.Unmarshal(section.Content, &content); err != nil {
			return 0
		}
		if len(content.Questions) > 0 {
			return len(content.Questions)
		}
		if strings.TrimSpace(content.Question) != "" {
			return 1
		}
		return 0
	}
	return 0
}
