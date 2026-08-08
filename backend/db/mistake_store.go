package db

import (
	"context"
	"crypto/rand"
	"fmt"
	"strings"
	"sync/atomic"

	"study-os/backend/models"
)

var mistakeSequence atomic.Uint64

// newMistakeID mints ids inside the store rather than at the caller, because a
// filed mistake is two rows written together: the attempt has to point at
// whichever question row this call produced.
func newMistakeID(prefix string) string {
	var random [4]byte
	_, _ = rand.Read(random[:])
	return fmt.Sprintf("%s-%d-%x", prefix, mistakeSequence.Add(1), random)
}

// RecordMistake files one wrong answer as a question plus an attempt on it.
//
// The two are separate rows because the same question gets attempted again
// after 订正 -- collapsing them would make "how many times did I get this
// wrong" unanswerable.
func (s *Store) RecordMistake(ctx context.Context, input models.MistakeInput) (models.Mistake, error) {
	stem := strings.TrimSpace(input.Stem)
	if stem == "" {
		return models.Mistake{}, fmt.Errorf("mistake stem is required")
	}
	occurredAt := input.OccurredAt.UTC()
	if occurredAt.IsZero() {
		occurredAt = nowUTC()
	}

	question := models.Question{
		ID:        newMistakeID("q"),
		Subject:   strings.TrimSpace(input.Subject),
		Stem:      stem,
		CreatedAt: occurredAt,
	}
	attempt := models.QuestionAttempt{
		ID:         newMistakeID("qa"),
		QuestionID: question.ID,
		Cause:      strings.TrimSpace(input.Cause),
		Note:       strings.TrimSpace(input.Note),
		OccurredAt: occurredAt,
	}

	transaction, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return models.Mistake{}, err
	}
	defer func() { _ = transaction.Rollback() }()

	if _, err := transaction.ExecContext(ctx, `
		INSERT INTO questions(id, subject, stem, source_id, created_at)
		VALUES (?, ?, ?, ?, ?)`,
		question.ID, question.Subject, question.Stem, question.SourceID, formatTime(question.CreatedAt),
	); err != nil {
		return models.Mistake{}, err
	}
	if _, err := transaction.ExecContext(ctx, `
		INSERT INTO question_attempts(id, question_id, cause, note, occurred_at)
		VALUES (?, ?, ?, ?, ?)`,
		attempt.ID, attempt.QuestionID, attempt.Cause, attempt.Note, formatTime(attempt.OccurredAt),
	); err != nil {
		return models.Mistake{}, err
	}
	if err := transaction.Commit(); err != nil {
		return models.Mistake{}, err
	}
	return models.Mistake{Question: question, Attempt: attempt}, nil
}

// ListMistakes returns the most recent attempts, newest first, narrowed to a
// subject when one is given -- every list in the app follows the 首页 switch.
func (s *Store) ListMistakes(ctx context.Context, options models.MistakeListOptions) ([]models.Mistake, error) {
	limit := options.Limit
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	query := `
		SELECT a.id, a.question_id, a.cause, a.note, a.occurred_at,
		       q.subject, q.stem, q.source_id, q.created_at
		FROM question_attempts a
		JOIN questions q ON q.id = a.question_id`
	arguments := make([]any, 0, 2)
	if subject := strings.TrimSpace(options.Subject); subject != "" {
		query += ` WHERE q.subject = ?`
		arguments = append(arguments, subject)
	}
	query += ` ORDER BY a.occurred_at DESC, a.id DESC LIMIT ?`
	arguments = append(arguments, limit)

	rows, err := s.db.QueryContext(ctx, query, arguments...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	mistakes := make([]models.Mistake, 0, limit)
	for rows.Next() {
		mistake, err := scanMistake(rows)
		if err != nil {
			return nil, err
		}
		mistakes = append(mistakes, mistake)
	}
	return mistakes, rows.Err()
}

func scanMistake(row scanner) (models.Mistake, error) {
	var mistake models.Mistake
	var occurredAt, createdAt string
	if err := row.Scan(
		&mistake.Attempt.ID, &mistake.Attempt.QuestionID, &mistake.Attempt.Cause, &mistake.Attempt.Note, &occurredAt,
		&mistake.Question.Subject, &mistake.Question.Stem, &mistake.Question.SourceID, &createdAt,
	); err != nil {
		return models.Mistake{}, err
	}
	mistake.Question.ID = mistake.Attempt.QuestionID
	parsedOccurred, err := parseTime(occurredAt)
	if err != nil {
		return models.Mistake{}, err
	}
	mistake.Attempt.OccurredAt = parsedOccurred
	parsedCreated, err := parseTime(createdAt)
	if err != nil {
		return models.Mistake{}, err
	}
	mistake.Question.CreatedAt = parsedCreated
	return mistake, nil
}
