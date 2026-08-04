package db

import (
	"context"
	"encoding/json"
	"fmt"

	"study-os/backend/models"
)

func (s *Store) CreateIntegratedNote(ctx context.Context, note models.IntegratedNote) error {
	return createIntegratedNote(ctx, s.db, note)
}

func (s *TxStore) CreateIntegratedNote(ctx context.Context, note models.IntegratedNote) error {
	return createIntegratedNote(ctx, s.tx, note)
}

func createIntegratedNote(ctx context.Context, database queryer, note models.IntegratedNote) error {
	if note.ID == "" || note.Title == "" {
		return fmt.Errorf("integrated note id and title are required")
	}
	createdAt := note.CreatedAt.UTC()
	if createdAt.IsZero() {
		createdAt = nowUTC()
	}
	mindmap := note.MindmapJSON
	if len(mindmap) == 0 {
		mindmap = json.RawMessage(`{}`)
	}
	cards := note.CardsJSON
	if len(cards) == 0 {
		cards = json.RawMessage(`[]`)
	}
	_, err := database.ExecContext(ctx, `
		INSERT INTO integrated_notes(id, subject, title, source_type, source_id, mindmap_json, cards_json, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		note.ID, note.Subject, note.Title, note.SourceType, note.SourceID,
		string(mindmap), string(cards), formatTime(createdAt))
	return err
}

func (s *Store) GetIntegratedNote(ctx context.Context, id string) (models.IntegratedNote, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT id, subject, title, source_type, source_id, mindmap_json, cards_json, created_at
		FROM integrated_notes WHERE id = ?`, id)
	note, err := scanIntegratedNote(row)
	if err != nil {
		return models.IntegratedNote{}, mapNotFound(err, "integrated note")
	}
	return note, nil
}

func (s *Store) ListIntegratedNotes(ctx context.Context, subject string, limit int) ([]models.IntegratedNote, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	query := `SELECT id, subject, title, source_type, source_id, mindmap_json, cards_json, created_at
		FROM integrated_notes`
	arguments := make([]any, 0, 2)
	if subject != "" {
		query += ` WHERE subject = ?`
		arguments = append(arguments, subject)
	}
	query += ` ORDER BY created_at DESC LIMIT ?`
	arguments = append(arguments, limit)
	rows, err := s.db.QueryContext(ctx, query, arguments...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	notes := make([]models.IntegratedNote, 0)
	for rows.Next() {
		note, err := scanIntegratedNote(rows)
		if err != nil {
			return nil, err
		}
		notes = append(notes, note)
	}
	return notes, rows.Err()
}

func scanIntegratedNote(row scanner) (models.IntegratedNote, error) {
	var note models.IntegratedNote
	var mindmap, cards, createdAt string
	if err := row.Scan(&note.ID, &note.Subject, &note.Title, &note.SourceType, &note.SourceID,
		&mindmap, &cards, &createdAt); err != nil {
		return models.IntegratedNote{}, err
	}
	note.MindmapJSON = json.RawMessage(mindmap)
	note.CardsJSON = json.RawMessage(cards)
	var err error
	if note.CreatedAt, err = parseTime(createdAt); err != nil {
		return models.IntegratedNote{}, fmt.Errorf("parse integrated note created time: %w", err)
	}
	return note, nil
}
