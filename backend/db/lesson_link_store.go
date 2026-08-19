package db

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"study-os/backend/models"
)

// ErrLessonLinkAlreadyExists identifies an idempotency conflict on the same
// lesson/target pair. The composite primary key keeps duplicate references out
// of the graph while this sentinel keeps the HTTP contract driver-independent.
var ErrLessonLinkAlreadyExists = errors.New("lesson link already exists")

// ErrInvalidLessonLink identifies malformed link input before it reaches SQL.
var ErrInvalidLessonLink = errors.New("invalid lesson link")

func (s *Store) CreateLessonLink(ctx context.Context, link models.LessonLink) error {
	if s == nil || s.db == nil {
		return errors.New("store is unavailable")
	}
	return s.WithTx(ctx, func(tx *TxStore) error {
		return createLessonLink(ctx, tx.tx, link)
	})
}

func (s *TxStore) CreateLessonLink(ctx context.Context, link models.LessonLink) error {
	if s == nil || s.tx == nil {
		return errors.New("transaction is unavailable")
	}
	return createLessonLink(ctx, s.tx, link)
}

func createLessonLink(ctx context.Context, database queryer, link models.LessonLink) error {
	link.LessonID = strings.TrimSpace(link.LessonID)
	link.TargetType = strings.TrimSpace(link.TargetType)
	link.TargetID = strings.TrimSpace(link.TargetID)
	if link.LessonID == "" {
		return fmt.Errorf("%w: lesson id is required", ErrInvalidLessonLink)
	}
	if !models.IsLessonLinkTargetValid(link.TargetType) {
		return fmt.Errorf("%w: target type must be knowledge_item or prompt", ErrInvalidLessonLink)
	}
	if link.TargetID == "" {
		return fmt.Errorf("%w: target id is required", ErrInvalidLessonLink)
	}
	if err := ensureLessonLinkEntity(ctx, database, "lessons", link.LessonID, "lesson"); err != nil {
		return err
	}
	if err := ensureLessonLinkEntity(ctx, database, lessonLinkTargetTable(link.TargetType), link.TargetID, link.TargetType); err != nil {
		return err
	}
	var exists bool
	if err := database.QueryRowContext(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM lesson_links
			WHERE lesson_id = ? AND target_type = ? AND target_id = ?
		)`, link.LessonID, link.TargetType, link.TargetID).Scan(&exists); err != nil {
		return fmt.Errorf("check lesson link: %w", err)
	}
	if exists {
		return ErrLessonLinkAlreadyExists
	}
	createdAt, _ := normalizedTimes(link.CreatedAt, link.CreatedAt)
	if _, err := database.ExecContext(ctx, `
		INSERT INTO lesson_links(lesson_id, target_type, target_id, created_at)
		VALUES (?, ?, ?, ?)`, link.LessonID, link.TargetType, link.TargetID, formatTime(createdAt)); err != nil {
		return fmt.Errorf("create lesson link: %w", err)
	}
	return nil
}

func (s *Store) ListLessonLinks(ctx context.Context, lessonID string, options models.LessonLinkListOptions) ([]models.LessonLink, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("store is unavailable")
	}
	lessonID = strings.TrimSpace(lessonID)
	if lessonID == "" {
		return nil, fmt.Errorf("%w: lesson id is required", ErrInvalidLessonLink)
	}
	if err := ensureLessonLinkEntity(ctx, s.db, "lessons", lessonID, "lesson"); err != nil {
		return nil, err
	}
	targetType := strings.TrimSpace(options.TargetType)
	if targetType != "" && !models.IsLessonLinkTargetValid(targetType) {
		return nil, fmt.Errorf("%w: invalid target type", ErrInvalidLessonLink)
	}
	limit := options.Limit
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	offset := options.Offset
	if offset < 0 {
		offset = 0
	}
	query := `SELECT lesson_id, target_type, target_id, created_at FROM lesson_links WHERE lesson_id = ?`
	arguments := []any{lessonID}
	if targetType != "" {
		query += ` AND target_type = ?`
		arguments = append(arguments, targetType)
	}
	query += ` ORDER BY created_at ASC, target_type ASC, target_id ASC LIMIT ? OFFSET ?`
	arguments = append(arguments, limit, offset)
	rows, err := s.db.QueryContext(ctx, query, arguments...)
	if err != nil {
		return nil, fmt.Errorf("list lesson links: %w", err)
	}
	defer rows.Close()
	links := make([]models.LessonLink, 0)
	for rows.Next() {
		link, err := scanLessonLink(rows)
		if err != nil {
			return nil, err
		}
		links = append(links, link)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate lesson links: %w", err)
	}
	return links, nil
}

func (s *Store) ListLessonsForLink(ctx context.Context, targetType, targetID string) ([]models.LessonSummary, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("store is unavailable")
	}
	targetType = strings.TrimSpace(targetType)
	targetID = strings.TrimSpace(targetID)
	if !models.IsLessonLinkTargetValid(targetType) {
		return nil, fmt.Errorf("%w: invalid target type", ErrInvalidLessonLink)
	}
	if targetID == "" {
		return nil, fmt.Errorf("%w: target id is required", ErrInvalidLessonLink)
	}
	if err := ensureLessonLinkEntity(ctx, s.db, lessonLinkTargetTable(targetType), targetID, targetType); err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT l.id, l.subject, l.title, l.source_type, l.source_id, l.status,
			l.current_version, l.created_at, l.updated_at
		FROM lesson_links AS ll
		JOIN lessons AS l ON l.id = ll.lesson_id
		WHERE ll.target_type = ? AND ll.target_id = ?
		ORDER BY l.updated_at DESC, l.id ASC`, targetType, targetID)
	if err != nil {
		return nil, fmt.Errorf("list lessons for link: %w", err)
	}
	defer rows.Close()
	lessons := make([]models.LessonSummary, 0)
	for rows.Next() {
		var lesson models.LessonSummary
		var createdAt, updatedAt string
		if err := rows.Scan(&lesson.ID, &lesson.Subject, &lesson.Title, &lesson.SourceType,
			&lesson.SourceID, &lesson.Status, &lesson.CurrentVersion, &createdAt, &updatedAt); err != nil {
			return nil, fmt.Errorf("scan lesson for link: %w", err)
		}
		var err error
		if lesson.CreatedAt, err = parseTime(createdAt); err != nil {
			return nil, fmt.Errorf("parse linked lesson created time: %w", err)
		}
		if lesson.UpdatedAt, err = parseTime(updatedAt); err != nil {
			return nil, fmt.Errorf("parse linked lesson updated time: %w", err)
		}
		lessons = append(lessons, lesson)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate lessons for link: %w", err)
	}
	return lessons, nil
}

func (s *Store) DeleteLessonLink(ctx context.Context, lessonID, targetType, targetID string) error {
	if s == nil || s.db == nil {
		return errors.New("store is unavailable")
	}
	lessonID = strings.TrimSpace(lessonID)
	targetType = strings.TrimSpace(targetType)
	targetID = strings.TrimSpace(targetID)
	if lessonID == "" || targetID == "" || !models.IsLessonLinkTargetValid(targetType) {
		return fmt.Errorf("%w: lesson id, target type, and target id are required", ErrInvalidLessonLink)
	}
	result, err := s.db.ExecContext(ctx, `
		DELETE FROM lesson_links WHERE lesson_id = ? AND target_type = ? AND target_id = ?`,
		lessonID, targetType, targetID)
	if err != nil {
		return fmt.Errorf("delete lesson link: %w", err)
	}
	return requireChanged(result, "lesson link")
}

func ensureLessonLinkEntity(ctx context.Context, database queryer, table, id, kind string) error {
	var exists bool
	if err := database.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM `+table+` WHERE id = ?)`, id).Scan(&exists); err != nil {
		return fmt.Errorf("check %s: %w", kind, err)
	}
	if !exists {
		return fmt.Errorf("%s %q: %w", kind, id, ErrNotFound)
	}
	return nil
}

func lessonLinkTargetTable(targetType string) string {
	if targetType == models.LessonLinkTargetPrompt {
		return "prompts"
	}
	return "knowledge_items"
}

func scanLessonLink(row scanner) (models.LessonLink, error) {
	var link models.LessonLink
	var createdAt string
	if err := row.Scan(&link.LessonID, &link.TargetType, &link.TargetID, &createdAt); err != nil {
		return models.LessonLink{}, fmt.Errorf("scan lesson link: %w", err)
	}
	var err error
	if link.CreatedAt, err = parseTime(createdAt); err != nil {
		return models.LessonLink{}, fmt.Errorf("parse lesson link time: %w", err)
	}
	return link, nil
}
