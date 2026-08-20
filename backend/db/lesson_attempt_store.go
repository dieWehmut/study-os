package db

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"study-os/backend/models"
)

// ErrInvalidLessonPracticeAttempt identifies malformed evidence before it
// reaches SQLite. The HTTP layer maps it to a client error.
var ErrInvalidLessonPracticeAttempt = errors.New("invalid lesson practice attempt")

// ErrLessonPracticeAttemptAlreadyExists gives callers a stable conflict error
// when an id is accidentally reused.
var ErrLessonPracticeAttemptAlreadyExists = errors.New("lesson practice attempt already exists")

func (s *Store) CreateLessonPracticeAttempt(ctx context.Context, attempt models.LessonPracticeAttempt) error {
	if s == nil || s.db == nil {
		return errors.New("store is unavailable")
	}
	return s.WithTx(ctx, func(tx *TxStore) error {
		return tx.createLessonPracticeAttempt(ctx, attempt)
	})
}

func (s *TxStore) CreateLessonPracticeAttempt(ctx context.Context, attempt models.LessonPracticeAttempt) error {
	return s.createLessonPracticeAttempt(ctx, attempt)
}

func (s *TxStore) createLessonPracticeAttempt(ctx context.Context, attempt models.LessonPracticeAttempt) error {
	if s == nil || s.tx == nil {
		return errors.New("transaction is unavailable")
	}
	attempt.ID = strings.TrimSpace(attempt.ID)
	attempt.LessonID = strings.TrimSpace(attempt.LessonID)
	attempt.SectionID = strings.TrimSpace(attempt.SectionID)
	attempt.Evaluation = strings.TrimSpace(attempt.Evaluation)
	if err := attempt.Validate(); err != nil {
		return fmt.Errorf("%w: %v", ErrInvalidLessonPracticeAttempt, err)
	}
	var lessonExists bool
	if err := s.tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM lessons WHERE id = ?)`, attempt.LessonID).Scan(&lessonExists); err != nil {
		return fmt.Errorf("check lesson for practice attempt: %w", err)
	}
	if !lessonExists {
		return fmt.Errorf("lesson %q: %w", attempt.LessonID, ErrNotFound)
	}
	var attemptExists bool
	if err := s.tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM lesson_attempts WHERE id = ?)`, attempt.ID).Scan(&attemptExists); err != nil {
		return fmt.Errorf("check lesson practice attempt: %w", err)
	}
	if attemptExists {
		return ErrLessonPracticeAttemptAlreadyExists
	}
	createdAt := attempt.CreatedAt.UTC()
	if createdAt.IsZero() {
		createdAt = time.Now().UTC()
	}
	if _, err := s.tx.ExecContext(ctx, `
		INSERT INTO lesson_attempts(
			id, lesson_id, section_id, answer, evaluation,
			reference_answer, feedback, elapsed_ms, created_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		attempt.ID, attempt.LessonID, attempt.SectionID, attempt.Answer, attempt.Evaluation,
		attempt.ReferenceAnswer, attempt.Feedback, attempt.ElapsedMS, formatTime(createdAt)); err != nil {
		return fmt.Errorf("create lesson practice attempt %q: %w", attempt.ID, err)
	}
	return nil
}

func (s *Store) ListLessonPracticeAttempts(ctx context.Context, lessonID, sectionID string, options ...models.LessonPracticeAttemptListOptions) ([]models.LessonPracticeAttempt, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("store is unavailable")
	}
	lessonID = strings.TrimSpace(lessonID)
	sectionID = strings.TrimSpace(sectionID)
	if lessonID == "" || sectionID == "" {
		return nil, fmt.Errorf("%w: lesson and section ids are required", ErrInvalidLessonPracticeAttempt)
	}
	var lessonExists bool
	if err := s.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM lessons WHERE id = ?)`, lessonID).Scan(&lessonExists); err != nil {
		return nil, fmt.Errorf("check lesson for practice attempts: %w", err)
	}
	if !lessonExists {
		return nil, fmt.Errorf("lesson %q: %w", lessonID, ErrNotFound)
	}
	listOptions := models.LessonPracticeAttemptListOptions{}
	if len(options) > 0 {
		listOptions = options[0]
	}
	limit := listOptions.Limit
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	offset := listOptions.Offset
	if offset < 0 {
		offset = 0
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, lesson_id, section_id, answer, evaluation,
			reference_answer, feedback, elapsed_ms, created_at
		FROM lesson_attempts
		WHERE lesson_id = ? AND section_id = ?
		ORDER BY created_at DESC, id DESC
		LIMIT ? OFFSET ?`, lessonID, sectionID, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("list lesson practice attempts: %w", err)
	}
	defer rows.Close()
	items := make([]models.LessonPracticeAttempt, 0)
	for rows.Next() {
		item, scanErr := scanLessonPracticeAttempt(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate lesson practice attempts: %w", err)
	}
	return items, nil
}

func scanLessonPracticeAttempt(row scanner) (models.LessonPracticeAttempt, error) {
	var item models.LessonPracticeAttempt
	var createdAt string
	if err := row.Scan(&item.ID, &item.LessonID, &item.SectionID, &item.Answer,
		&item.Evaluation, &item.ReferenceAnswer, &item.Feedback, &item.ElapsedMS, &createdAt); err != nil {
		return models.LessonPracticeAttempt{}, fmt.Errorf("scan lesson practice attempt: %w", err)
	}
	var err error
	if item.CreatedAt, err = parseTime(createdAt); err != nil {
		return models.LessonPracticeAttempt{}, fmt.Errorf("parse lesson practice attempt time: %w", err)
	}
	return item, nil
}
