package db

import (
	"context"
	"fmt"
	"strings"

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

func (s *Store) ListChatMessages(ctx context.Context, subject, sessionID string, limit int) ([]models.ChatMessage, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	query := `SELECT id, session_id, subject, role, content, status, error_summary, created_at
		FROM chat_messages`
	arguments := make([]any, 0, 3)
	if subject != "" {
		query += ` WHERE subject = ?`
		arguments = append(arguments, subject)
	}
	if sessionID != "" {
		if subject == "" {
			query += ` WHERE session_id = ?`
		} else {
			query += ` AND session_id = ?`
		}
		arguments = append(arguments, sessionID)
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

func (s *Store) CreateChatAttachment(ctx context.Context, attachment models.ChatAttachment) error {
	createdAt := attachment.CreatedAt.UTC()
	if createdAt.IsZero() {
		createdAt = nowUTC()
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO chat_attachments(id, session_id, subject, message_id, name, stored_path, size_bytes, kind, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		attachment.ID, attachment.SessionID, attachment.Subject, attachment.MessageID,
		attachment.Name, attachment.StoredPath, attachment.SizeBytes, attachment.Kind, formatTime(createdAt))
	return err
}

func (s *Store) UpdateChatAttachment(ctx context.Context, id, sessionID, subject, messageID string) error {
	result, err := s.db.ExecContext(ctx, `
		UPDATE chat_attachments SET session_id = ?, subject = ?, message_id = ? WHERE id = ?`,
		sessionID, subject, messageID, id)
	if err != nil {
		return err
	}
	return requireChanged(result, "chat attachment")
}

func (s *Store) GetChatAttachment(ctx context.Context, id string) (models.ChatAttachment, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT id, session_id, subject, message_id, name, stored_path, size_bytes, kind, created_at
		FROM chat_attachments WHERE id = ?`, id)
	var attachment models.ChatAttachment
	var createdAt string
	if err := row.Scan(&attachment.ID, &attachment.SessionID, &attachment.Subject, &attachment.MessageID,
		&attachment.Name, &attachment.StoredPath, &attachment.SizeBytes, &attachment.Kind, &createdAt); err != nil {
		return models.ChatAttachment{}, mapNotFound(err, "chat attachment")
	}
	var err error
	if attachment.CreatedAt, err = parseTime(createdAt); err != nil {
		return models.ChatAttachment{}, fmt.Errorf("parse attachment created time: %w", err)
	}
	return attachment, nil
}

// conversationScope is the WHERE every read of the conversation list shares, so
// a page and its total cannot be about different sets.
//
// 综合 means "every subject", the way it does in every other list in the app --
// and the way ListChatMessages already reads an empty subject two functions up.
// It used to be a literal bucket here: conversations asked while 综合 was
// selected are stored with subject "all", so filtering on it hid every
// conversation asked under a subject and left the sidebar claiming 还没有对话.
func conversationScope(options models.ChatConversationListOptions) (string, []any) {
	where := make([]string, 0, 2)
	arguments := make([]any, 0, 2)
	if subject := strings.ToLower(strings.TrimSpace(options.Subject)); subject != "" && subject != "all" {
		where = append(where, `c.subject = ?`)
		arguments = append(arguments, subject)
	}
	// A conversation matches on any of its messages, not only on the two the row
	// happens to show: the thing you remember saying is often neither the first
	// question nor the last answer.
	if needle := strings.TrimSpace(options.Query); needle != "" {
		where = append(where, `EXISTS (SELECT 1 FROM chat_messages m
			WHERE m.session_id = c.session_id AND m.content LIKE ? ESCAPE '\')`)
		arguments = append(arguments, "%"+escapeLike(needle)+"%")
	}
	if len(where) == 0 {
		return "", nil
	}
	return ` WHERE ` + strings.Join(where, " AND "), arguments
}

// CountChatConversations answers how many conversations match, not how many fit
// on a page -- the sidebar says "N 段对话" and offers a next page from it.
func (s *Store) CountChatConversations(ctx context.Context, options models.ChatConversationListOptions) (int, error) {
	scope, arguments := conversationScope(options)
	var total int
	err := s.db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM (
			SELECT c.session_id FROM chat_messages c`+scope+`
			GROUP BY c.session_id, c.subject
		)`, arguments...).Scan(&total)
	if err != nil {
		return 0, fmt.Errorf("count chat conversations: %w", err)
	}
	return total, nil
}

func (s *Store) ListChatConversations(ctx context.Context, options models.ChatConversationListOptions) ([]models.ChatConversation, error) {
	limit := options.Limit
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	offset := options.Offset
	if offset < 0 {
		offset = 0
	}
	scope, arguments := conversationScope(options)
	arguments = append(arguments, limit, offset)
	rows, err := s.db.QueryContext(ctx, `
		SELECT c.session_id, c.subject, COUNT(*),
			MAX(c.created_at),
			COALESCE((SELECT u.content FROM chat_messages u
				WHERE u.session_id = c.session_id AND u.role = 'user'
				ORDER BY u.created_at ASC LIMIT 1), ''),
			COALESCE((SELECT p.content FROM chat_messages p
				WHERE p.session_id = c.session_id AND p.status = 'done' AND p.content <> ''
				ORDER BY p.created_at DESC LIMIT 1), '')
		FROM chat_messages c`+scope+`
		GROUP BY c.session_id, c.subject
		ORDER BY MAX(c.created_at) DESC
		LIMIT ? OFFSET ?`, arguments...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	conversations := make([]models.ChatConversation, 0)
	for rows.Next() {
		var conversation models.ChatConversation
		var lastAt string
		if err := rows.Scan(&conversation.SessionID, &conversation.Subject, &conversation.MessageCount,
			&lastAt, &conversation.Title, &conversation.Preview); err != nil {
			return nil, err
		}
		if conversation.LastAt, err = parseTime(lastAt); err != nil {
			return nil, fmt.Errorf("parse conversation time: %w", err)
		}
		conversations = append(conversations, conversation)
	}
	return conversations, rows.Err()
}
