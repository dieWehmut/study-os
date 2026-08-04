package db

import (
	"context"
	"fmt"

	"study-os/backend/models"
)

func (s *Store) CreateChatMessage(ctx context.Context, message models.ChatMessage) error {
	return createChatMessage(ctx, s.db, message)
}

func (s *TxStore) CreateChatMessage(ctx context.Context, message models.ChatMessage) error {
	return createChatMessage(ctx, s.tx, message)
}

func createChatMessage(ctx context.Context, database queryer, message models.ChatMessage) error {
	if message.ID == "" || message.Role == "" {
		return fmt.Errorf("chat message id and role are required")
	}
	createdAt := message.CreatedAt.UTC()
	if createdAt.IsZero() {
		createdAt = nowUTC()
	}
	if message.Status == "" {
		message.Status = "done"
	}
	_, err := database.ExecContext(ctx, `
		INSERT INTO chat_messages(id, session_id, subject, role, content, status, error_summary, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		message.ID, message.SessionID, message.Subject, message.Role,
		message.Content, message.Status, message.ErrorSummary, formatTime(createdAt))
	return err
}

func (s *Store) UpdateChatMessage(ctx context.Context, id, content, status, errorSummary string) error {
	result, err := s.db.ExecContext(ctx, `
		UPDATE chat_messages SET content = ?, status = ?, error_summary = ? WHERE id = ?`,
		content, status, errorSummary, id)
	if err != nil {
		return err
	}
	return requireChanged(result, "chat message")
}

func (s *Store) ListChatMessages(ctx context.Context, subject string, limit int) ([]models.ChatMessage, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	query := `SELECT id, session_id, subject, role, content, status, error_summary, created_at
		FROM chat_messages`
	arguments := make([]any, 0, 2)
	if subject != "" {
		query += ` WHERE subject = ?`
		arguments = append(arguments, subject)
	}
	query += ` ORDER BY created_at ASC LIMIT ?`
	arguments = append(arguments, limit)
	rows, err := s.db.QueryContext(ctx, query, arguments...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	messages := make([]models.ChatMessage, 0)
	for rows.Next() {
		var message models.ChatMessage
		var createdAt string
		if err := rows.Scan(&message.ID, &message.SessionID, &message.Subject, &message.Role,
			&message.Content, &message.Status, &message.ErrorSummary, &createdAt); err != nil {
			return nil, err
		}
		if message.CreatedAt, err = parseTime(createdAt); err != nil {
			return nil, fmt.Errorf("parse chat created time: %w", err)
		}
		messages = append(messages, message)
	}
	return messages, rows.Err()
}
