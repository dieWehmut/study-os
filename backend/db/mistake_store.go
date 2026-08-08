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
		// One spelling per cause, decided here. The page names a row by
		// looking its cause up in a closed taxonomy by exact string and drops
		// what it cannot name, so a stray "Recall " would be a mistake you
		// filed and can never see again.
		Cause:      strings.ToLower(strings.TrimSpace(input.Cause)),
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

// mistakeSelect is shared by the list and the single-row read so the two can
// never disagree about which columns a mistake is made of.
//
// The last column derives 订正 instead of storing it. Existence, not order: a
// time comparison here would be unsound, because formatTime writes RFC3339Nano
// and that trims trailing zeros, so "T10:00:00.5Z" sorts before "T10:00:00Z".
// Existence is also enough -- RecordMistake mints a fresh question every time,
// so no question can go wrong, right, then wrong again.
const mistakeSelect = `
	SELECT a.id, a.question_id, a.cause, a.note, a.occurred_at,
	       q.subject, q.stem, q.source_id, q.knowledge_item_id, q.created_at,
	       EXISTS (SELECT 1 FROM question_attempts c
	               WHERE c.question_id = a.question_id AND c.cause = '')
	FROM question_attempts a
	JOIN questions q ON q.id = a.question_id`

// ListMistakes returns the most recent attempts, newest first, narrowed to a
// subject when one is given -- every list in the app follows the 首页 switch.
//
// Only attempts that blame something are mistakes. The 订正 retry lives in the
// same table and would otherwise take a row on the page and a slot out of the
// limit, pushing a real mistake off the end for having been fixed.
func (s *Store) ListMistakes(ctx context.Context, options models.MistakeListOptions) ([]models.Mistake, error) {
	limit := options.Limit
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	query := mistakeSelect + ` WHERE a.cause <> ''`
	arguments := make([]any, 0, 2)
	if subject := strings.TrimSpace(options.Subject); subject != "" {
		query += ` AND q.subject = ?`
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

// DeleteMistake removes one filed attempt, and the question with it when no
// other attempt still blames anything.
//
// "Still blames anything", not "still exists": the list join is inner and
// drops causeless attempts, so a question held up only by its 订正 retry would
// be a row nothing can see and nothing can ever delete. Dropping the question
// cascades the retry away with it.
func (s *Store) DeleteMistake(ctx context.Context, attemptID string) error {
	transaction, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = transaction.Rollback() }()

	var questionID string
	if err := transaction.QueryRowContext(ctx,
		`SELECT question_id FROM question_attempts WHERE id = ?`, attemptID,
	).Scan(&questionID); err != nil {
		return mapNotFound(err, "mistake")
	}
	if _, err := transaction.ExecContext(ctx, `DELETE FROM question_attempts WHERE id = ?`, attemptID); err != nil {
		return err
	}
	if _, err := transaction.ExecContext(ctx, `
		DELETE FROM questions
		WHERE id = ? AND NOT EXISTS (
			SELECT 1 FROM question_attempts WHERE question_id = ? AND cause <> ''
		)`,
		questionID, questionID,
	); err != nil {
		return err
	}
	return transaction.Commit()
}

// GetMistake returns one filed attempt with the question behind it.
func (s *Store) GetMistake(ctx context.Context, attemptID string) (models.Mistake, error) {
	mistake, err := scanMistake(s.db.QueryRowContext(ctx, mistakeSelect+`
		WHERE a.id = ?`, attemptID))
	if err != nil {
		return models.Mistake{}, mapNotFound(err, "mistake")
	}
	return mistake, nil
}

// CorrectMistake files the retry that finally got this question right.
//
// The retry is another attempt on the same question, carrying no cause -- the
// same two-row shape RecordMistake writes, which is what makes "how many times
// did I get this wrong" still countable afterwards. The guard is in the
// statement rather than around it so a double press cannot file two retries.
func (s *Store) CorrectMistake(ctx context.Context, attemptID string) (models.Mistake, error) {
	mistake, err := s.GetMistake(ctx, attemptID)
	if err != nil {
		return models.Mistake{}, err
	}
	if _, err := s.db.ExecContext(ctx, `
		INSERT INTO question_attempts(id, question_id, cause, note, occurred_at)
		SELECT ?, ?, '', '', ?
		WHERE NOT EXISTS (
			SELECT 1 FROM question_attempts WHERE question_id = ? AND cause = ''
		)`,
		newMistakeID("qa"), mistake.Question.ID, formatTime(nowUTC()), mistake.Question.ID,
	); err != nil {
		return models.Mistake{}, err
	}
	mistake.Corrected = true
	return mistake, nil
}

// LinkQuestionToKnowledge records which library entry a question became.
//
// The link lives on the question rather than as a "scheduled" flag so that
// "which item" and "was it filed" cannot drift apart -- the same reason
// knowledge scheduling counts prompt rows instead of setting a boolean.
func (s *TxStore) LinkQuestionToKnowledge(ctx context.Context, questionID, knowledgeID string) error {
	_, err := s.tx.ExecContext(ctx,
		`UPDATE questions SET knowledge_item_id = ? WHERE id = ?`, knowledgeID, questionID)
	return err
}

func scanMistake(row scanner) (models.Mistake, error) {
	var mistake models.Mistake
	var occurredAt, createdAt string
	if err := row.Scan(
		&mistake.Attempt.ID, &mistake.Attempt.QuestionID, &mistake.Attempt.Cause, &mistake.Attempt.Note, &occurredAt,
		&mistake.Question.Subject, &mistake.Question.Stem, &mistake.Question.SourceID,
		&mistake.Question.KnowledgeItemID, &createdAt, &mistake.Corrected,
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
