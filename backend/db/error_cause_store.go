package db

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"study-os/backend/models"
)

var ErrErrorCauseAlreadyExists = errors.New("error cause already exists")

var ErrInvalidErrorCause = errors.New("invalid error cause")

const errorCauseSelect = `SELECT id, subject, COALESCE(parent_id, ''), label,
	review_fixes, action, status, source_type, source_id, sort_order, created_at, updated_at
	FROM error_causes`

func (s *Store) CreateErrorCause(ctx context.Context, cause models.ErrorCause) error {
	if s == nil || s.db == nil {
		return errors.New("store is unavailable")
	}
	cause = normalizeErrorCause(cause)
	if cause.Status == "" {
		cause.Status = models.ErrorCauseStatusCandidate
	}
	if err := cause.Validate(); err != nil {
		return fmt.Errorf("%w: %v", ErrInvalidErrorCause, err)
	}
	createdAt, updatedAt := normalizedTimes(cause.CreatedAt, cause.UpdatedAt)
	cause.CreatedAt = createdAt
	cause.UpdatedAt = updatedAt
	return s.WithTx(ctx, func(tx *TxStore) error {
		if err := validateErrorCauseParent(ctx, tx.tx, cause); err != nil {
			return err
		}
		var exists bool
		if err := tx.tx.QueryRowContext(ctx,
			`SELECT EXISTS(SELECT 1 FROM error_causes WHERE id = ?)`, cause.ID,
		).Scan(&exists); err != nil {
			return fmt.Errorf("check error cause %q: %w", cause.ID, err)
		}
		if exists {
			return ErrErrorCauseAlreadyExists
		}
		_, err := tx.tx.ExecContext(ctx, `
			INSERT INTO error_causes(
				id, subject, parent_id, label, review_fixes, action, status,
				source_type, source_id, sort_order, created_at, updated_at
			) VALUES (?, ?, NULLIF(?, ''), ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			cause.ID, cause.Subject, cause.ParentID, cause.Label, cause.ReviewFixes,
			cause.Action, cause.Status, cause.SourceType, cause.SourceID, cause.SortOrder,
			formatTime(cause.CreatedAt), formatTime(cause.UpdatedAt),
		)
		if err != nil {
			return fmt.Errorf("create error cause %q: %w", cause.ID, err)
		}
		return nil
	})
}

func (s *Store) GetErrorCause(ctx context.Context, id string) (models.ErrorCause, error) {
	if s == nil || s.db == nil {
		return models.ErrorCause{}, errors.New("store is unavailable")
	}
	cause, err := scanErrorCause(s.db.QueryRowContext(ctx, errorCauseSelect+` WHERE id = ?`, strings.TrimSpace(id)))
	if err != nil {
		return models.ErrorCause{}, mapNotFound(err, "error cause")
	}
	return cause, nil
}

func (s *Store) ListErrorCauses(ctx context.Context, options models.ErrorCauseListOptions) ([]models.ErrorCause, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("store is unavailable")
	}
	subject := strings.ToLower(strings.TrimSpace(options.Subject))
	status := strings.TrimSpace(options.Status)
	if status == "" {
		status = models.ErrorCauseStatusConfirmed
	}
	if status != models.ErrorCauseStatusAll && !models.IsErrorCauseStatusValid(status) {
		return nil, fmt.Errorf("%w: invalid status %q", ErrInvalidErrorCause, status)
	}
	limit := options.Limit
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	offset := options.Offset
	if offset < 0 {
		offset = 0
	}
	query := errorCauseSelect
	where := make([]string, 0, 2)
	arguments := make([]any, 0, 4)
	if subject == "" {
		where = append(where, `subject = ''`)
	} else {
		where = append(where, `(subject = '' OR subject = ?)`)
		arguments = append(arguments, subject)
	}
	if status != models.ErrorCauseStatusAll {
		where = append(where, `status = ?`)
		arguments = append(arguments, status)
	}
	query += ` WHERE ` + strings.Join(where, ` AND `)
	query += ` ORDER BY CASE WHEN subject = '' THEN 0 ELSE 1 END, sort_order ASC, id ASC LIMIT ? OFFSET ?`
	arguments = append(arguments, limit, offset)
	rows, err := s.db.QueryContext(ctx, query, arguments...)
	if err != nil {
		return nil, fmt.Errorf("list error causes: %w", err)
	}
	defer rows.Close()
	causes := make([]models.ErrorCause, 0)
	for rows.Next() {
		cause, err := scanErrorCause(rows)
		if err != nil {
			return nil, err
		}
		causes = append(causes, cause)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate error causes: %w", err)
	}
	return causes, nil
}

func (s *Store) UpdateErrorCause(ctx context.Context, cause models.ErrorCause) (models.ErrorCause, error) {
	if s == nil || s.db == nil {
		return models.ErrorCause{}, errors.New("store is unavailable")
	}
	cause = normalizeErrorCause(cause)
	if err := cause.Validate(); err != nil {
		return models.ErrorCause{}, fmt.Errorf("%w: %v", ErrInvalidErrorCause, err)
	}
	err := s.WithTx(ctx, func(tx *TxStore) error {
		var existingSubject string
		if err := tx.tx.QueryRowContext(ctx, `SELECT subject FROM error_causes WHERE id = ?`, cause.ID).Scan(&existingSubject); err != nil {
			return mapNotFound(err, "error cause")
		}
		if existingSubject != cause.Subject {
			return fmt.Errorf("%w: error cause subject is immutable", ErrInvalidErrorCause)
		}
		if err := validateErrorCauseParent(ctx, tx.tx, cause); err != nil {
			return err
		}
		cause.UpdatedAt = nowUTC()
		result, err := tx.tx.ExecContext(ctx, `
			UPDATE error_causes SET parent_id = NULLIF(?, ''), label = ?, review_fixes = ?,
				action = ?, status = ?, source_type = ?, source_id = ?, sort_order = ?, updated_at = ?
			WHERE id = ?`,
			cause.ParentID, cause.Label, cause.ReviewFixes, cause.Action, cause.Status,
			cause.SourceType, cause.SourceID, cause.SortOrder, formatTime(cause.UpdatedAt), cause.ID,
		)
		if err != nil {
			return fmt.Errorf("update error cause %q: %w", cause.ID, err)
		}
		return requireChanged(result, "error cause")
	})
	if err != nil {
		return models.ErrorCause{}, err
	}
	return s.GetErrorCause(ctx, cause.ID)
}

func (s *Store) ReclassifyMistake(ctx context.Context, attemptID, causeID string) (models.Mistake, error) {
	if s == nil || s.db == nil {
		return models.Mistake{}, errors.New("store is unavailable")
	}
	attemptID = strings.TrimSpace(attemptID)
	causeID = strings.TrimSpace(causeID)
	if attemptID == "" || causeID == "" {
		return models.Mistake{}, fmt.Errorf("%w: attempt and cause ids are required", ErrInvalidErrorCause)
	}
	err := s.WithTx(ctx, func(tx *TxStore) error {
		var subject, existingCause string
		if err := tx.tx.QueryRowContext(ctx, `
			SELECT q.subject, a.cause
			FROM question_attempts AS a
			JOIN questions AS q ON q.id = a.question_id
			WHERE a.id = ?`, attemptID).Scan(&subject, &existingCause); err != nil {
			return mapNotFound(err, "mistake")
		}
		if strings.TrimSpace(existingCause) == "" {
			return fmt.Errorf("%w: attempt is not a filed mistake", ErrInvalidErrorCause)
		}
		applicable, err := applicableErrorCause(ctx, tx.tx, subject, causeID)
		if err != nil {
			return err
		}
		if !applicable {
			return fmt.Errorf("%w: cause is not confirmed for subject %q", ErrInvalidErrorCause, subject)
		}
		result, err := tx.tx.ExecContext(ctx, `UPDATE question_attempts SET cause = ? WHERE id = ?`, causeID, attemptID)
		if err != nil {
			return fmt.Errorf("reclassify mistake: %w", err)
		}
		return requireChanged(result, "mistake")
	})
	if err != nil {
		return models.Mistake{}, err
	}
	return s.GetMistake(ctx, attemptID)
}

func (s *Store) ErrorCauseReviewFixes(ctx context.Context, subject, causeID string) (bool, error) {
	if s == nil || s.db == nil {
		return false, errors.New("store is unavailable")
	}
	var reviewFixes bool
	err := s.db.QueryRowContext(ctx, `
		SELECT review_fixes FROM error_causes
		WHERE id = ? AND status = ? AND (subject = '' OR subject = ?)`,
		strings.TrimSpace(causeID), models.ErrorCauseStatusConfirmed,
		strings.ToLower(strings.TrimSpace(subject)),
	).Scan(&reviewFixes)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("read error cause review policy: %w", err)
	}
	return reviewFixes, nil
}

func applicableErrorCause(ctx context.Context, database queryer, subject, causeID string) (bool, error) {
	var applicable bool
	if err := database.QueryRowContext(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM error_causes
			WHERE id = ? AND status = ? AND (subject = '' OR subject = ?)
		)`, strings.TrimSpace(causeID), models.ErrorCauseStatusConfirmed,
		strings.ToLower(strings.TrimSpace(subject))).Scan(&applicable); err != nil {
		return false, fmt.Errorf("check applicable error cause: %w", err)
	}
	return applicable, nil
}

func validateErrorCauseParent(ctx context.Context, database queryer, cause models.ErrorCause) error {
	if cause.ParentID == "" {
		return nil
	}
	var parentSubject string
	if err := database.QueryRowContext(ctx,
		`SELECT subject FROM error_causes WHERE id = ?`, cause.ParentID,
	).Scan(&parentSubject); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("%w: parent error cause %q does not exist", ErrInvalidErrorCause, cause.ParentID)
		}
		return fmt.Errorf("read parent error cause: %w", err)
	}
	if parentSubject != "" && parentSubject != cause.Subject {
		return fmt.Errorf("%w: parent error cause belongs to another subject", ErrInvalidErrorCause)
	}
	if cause.Subject == "" && parentSubject != "" {
		return fmt.Errorf("%w: global error cause cannot use a subject parent", ErrInvalidErrorCause)
	}
	return nil
}

func normalizeErrorCause(cause models.ErrorCause) models.ErrorCause {
	cause.ID = strings.ToLower(strings.TrimSpace(cause.ID))
	cause.Subject = strings.ToLower(strings.TrimSpace(cause.Subject))
	cause.ParentID = strings.ToLower(strings.TrimSpace(cause.ParentID))
	cause.Label = strings.TrimSpace(cause.Label)
	cause.Action = strings.TrimSpace(cause.Action)
	cause.Status = strings.ToLower(strings.TrimSpace(cause.Status))
	cause.SourceType = strings.ToLower(strings.TrimSpace(cause.SourceType))
	cause.SourceID = strings.TrimSpace(cause.SourceID)
	return cause
}

func scanErrorCause(row scanner) (models.ErrorCause, error) {
	var cause models.ErrorCause
	var createdAt, updatedAt string
	if err := row.Scan(
		&cause.ID, &cause.Subject, &cause.ParentID, &cause.Label, &cause.ReviewFixes,
		&cause.Action, &cause.Status, &cause.SourceType, &cause.SourceID, &cause.SortOrder,
		&createdAt, &updatedAt,
	); err != nil {
		return models.ErrorCause{}, err
	}
	var err error
	if cause.CreatedAt, err = parseTime(createdAt); err != nil {
		return models.ErrorCause{}, fmt.Errorf("parse error cause created time: %w", err)
	}
	if cause.UpdatedAt, err = parseTime(updatedAt); err != nil {
		return models.ErrorCause{}, fmt.Errorf("parse error cause updated time: %w", err)
	}
	return cause, nil
}
