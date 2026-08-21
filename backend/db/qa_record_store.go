package db

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"study-os/backend/models"
)

var ErrInvalidQARecord = errors.New("invalid qa record")

const qaRecordSelect = `SELECT id, session_id, subject, context_type, context_id,
	original_understanding, corrected_model, mastery_evidence, unresolved, status,
	created_at, updated_at
	FROM qa_records`

func (s *Store) GetQARecord(ctx context.Context, sessionID string) (models.QARecord, error) {
	if s == nil || s.db == nil {
		return models.QARecord{}, errors.New("store is unavailable")
	}
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return models.QARecord{}, fmt.Errorf("%w: session id is required", ErrInvalidQARecord)
	}
	record, err := scanQARecord(s.db.QueryRowContext(ctx, qaRecordSelect+` WHERE session_id = ?`, sessionID))
	if err != nil {
		return models.QARecord{}, mapNotFound(err, "qa record")
	}
	return record, nil
}

func (s *Store) UpsertQARecord(ctx context.Context, record models.QARecord) (models.QARecord, error) {
	if s == nil || s.db == nil {
		return models.QARecord{}, errors.New("store is unavailable")
	}
	record = normalizeQARecord(record)
	if err := record.Validate(); err != nil {
		return models.QARecord{}, fmt.Errorf("%w: %v", ErrInvalidQARecord, err)
	}
	now := nowUTC()
	err := s.WithTx(ctx, func(tx *TxStore) error {
		if err := validateQARecordReferences(ctx, tx.tx, record); err != nil {
			return err
		}
		_, err := tx.tx.ExecContext(ctx, `
			INSERT INTO qa_records(
				id, session_id, subject, context_type, context_id,
				original_understanding, corrected_model, mastery_evidence, unresolved,
				status, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(session_id) DO UPDATE SET
				subject = excluded.subject,
				context_type = excluded.context_type,
				context_id = excluded.context_id,
				original_understanding = excluded.original_understanding,
				corrected_model = excluded.corrected_model,
				mastery_evidence = excluded.mastery_evidence,
				unresolved = excluded.unresolved,
				status = excluded.status,
				updated_at = excluded.updated_at`,
			record.ID, record.SessionID, record.Subject, record.ContextType, record.ContextID,
			record.OriginalUnderstanding, record.CorrectedModel, record.MasteryEvidence,
			record.Unresolved, record.Status, formatTime(now), formatTime(now),
		)
		if err != nil {
			return fmt.Errorf("upsert qa record for session %q: %w", record.SessionID, err)
		}
		return nil
	})
	if err != nil {
		return models.QARecord{}, err
	}
	return s.GetQARecord(ctx, record.SessionID)
}

func validateQARecordReferences(ctx context.Context, database queryer, record models.QARecord) error {
	var sessionExists bool
	if err := database.QueryRowContext(ctx,
		`SELECT EXISTS(SELECT 1 FROM chat_messages WHERE session_id = ?)`, record.SessionID,
	).Scan(&sessionExists); err != nil {
		return fmt.Errorf("check chat session for qa record: %w", err)
	}
	if !sessionExists {
		return fmt.Errorf("chat session %q: %w", record.SessionID, ErrNotFound)
	}
	if record.ContextType == "" {
		return nil
	}
	table := qaRecordContextTable(record.ContextType)
	var contextExists bool
	if err := database.QueryRowContext(ctx,
		fmt.Sprintf(`SELECT EXISTS(SELECT 1 FROM %s WHERE id = ?)`, table), record.ContextID,
	).Scan(&contextExists); err != nil {
		return fmt.Errorf("check %s context for qa record: %w", record.ContextType, err)
	}
	if !contextExists {
		return fmt.Errorf("%s context %q: %w", record.ContextType, record.ContextID, ErrNotFound)
	}
	return nil
}

func qaRecordContextTable(contextType string) string {
	switch contextType {
	case models.QARecordContextKnowledgeItem:
		return "knowledge_items"
	case models.QARecordContextQuestion:
		return "questions"
	case models.QARecordContextLesson:
		return "lessons"
	default:
		panic("validated qa record context type is unsupported")
	}
}

func normalizeQARecord(record models.QARecord) models.QARecord {
	record.ID = strings.TrimSpace(record.ID)
	record.SessionID = strings.TrimSpace(record.SessionID)
	record.Subject = strings.TrimSpace(record.Subject)
	record.ContextType = strings.TrimSpace(record.ContextType)
	record.ContextID = strings.TrimSpace(record.ContextID)
	record.Status = strings.TrimSpace(record.Status)
	return record
}

func scanQARecord(row scanner) (models.QARecord, error) {
	var record models.QARecord
	var createdAt, updatedAt string
	if err := row.Scan(
		&record.ID, &record.SessionID, &record.Subject, &record.ContextType, &record.ContextID,
		&record.OriginalUnderstanding, &record.CorrectedModel, &record.MasteryEvidence,
		&record.Unresolved, &record.Status, &createdAt, &updatedAt,
	); err != nil {
		return models.QARecord{}, err
	}
	var err error
	if record.CreatedAt, err = parseTime(createdAt); err != nil {
		return models.QARecord{}, fmt.Errorf("parse qa record created time: %w", err)
	}
	if record.UpdatedAt, err = parseTime(updatedAt); err != nil {
		return models.QARecord{}, fmt.Errorf("parse qa record updated time: %w", err)
	}
	return record, nil
}
