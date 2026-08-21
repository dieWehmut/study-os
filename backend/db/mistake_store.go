package db

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync/atomic"

	"study-os/backend/models"
)

var mistakeSequence atomic.Uint64

// ErrInvalidMistakeEvidence identifies a subject artifact that cannot be
// attached to the selected question attempt.
var ErrInvalidMistakeEvidence = errors.New("invalid mistake evidence")

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
	evidence, err := models.NormalizeSubjectAttemptEvidence(input.Subject, input.EvidenceJSON)
	if err != nil {
		return models.Mistake{}, fmt.Errorf("%w: %v", ErrInvalidMistakeEvidence, err)
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
		Answer:     strings.TrimSpace(input.Answer),
		ElapsedMS:  input.ElapsedMS,
		OccurredAt: occurredAt,
	}
	if attempt.ElapsedMS < 0 {
		return models.Mistake{}, fmt.Errorf("mistake elapsed_ms cannot be negative")
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
		INSERT INTO question_attempts(id, question_id, cause, note, answer, elapsed_ms, is_correct, evidence_json, occurred_at)
		VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
		attempt.ID, attempt.QuestionID, attempt.Cause, attempt.Note, attempt.Answer, attempt.ElapsedMS,
		evidence, formatTime(attempt.OccurredAt),
	); err != nil {
		return models.Mistake{}, err
	}
	attempt.EvidenceJSON = evidence
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
	SELECT a.id, a.question_id, a.cause, a.note, a.answer, a.elapsed_ms, a.is_correct, a.evidence_json, a.occurred_at,
	       q.subject, q.stem, q.source_id, q.knowledge_item_id, q.created_at,
	       EXISTS (SELECT 1 FROM question_attempts c
	               WHERE c.question_id = a.question_id AND c.is_correct = 1)
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
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	for index := range mistakes {
		if err := s.attachMistakeCorrection(ctx, &mistakes[index]); err != nil {
			return nil, err
		}
	}
	return mistakes, nil
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
	if err := s.attachMistakeCorrection(ctx, &mistake); err != nil {
		return models.Mistake{}, err
	}
	return mistake, nil
}

// RecordMistakeCorrection files the retry that finally got this question
// right, retaining the answer and elapsed time as evidence.
func (s *Store) RecordMistakeCorrection(ctx context.Context, attemptID string, input models.MistakeCorrectionInput) (models.Mistake, error) {
	return s.recordMistakeCorrection(ctx, attemptID, input, false)
}

// recordMistakeCorrection is shared with the legacy boolean-only entry point.
// The compatibility path may create an empty-evidence retry for existing
// callers; new API callers use the strict path above.
func (s *Store) recordMistakeCorrection(ctx context.Context, attemptID string, input models.MistakeCorrectionInput, allowEmpty bool) (models.Mistake, error) {
	answer := strings.TrimSpace(input.Answer)
	if !allowEmpty && answer == "" {
		return models.Mistake{}, fmt.Errorf("mistake correction answer is required")
	}
	if input.ElapsedMS < 0 {
		return models.Mistake{}, fmt.Errorf("mistake correction elapsed_ms cannot be negative")
	}
	occurredAt := input.OccurredAt.UTC()
	if occurredAt.IsZero() {
		occurredAt = nowUTC()
	}

	transaction, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return models.Mistake{}, err
	}
	defer func() { _ = transaction.Rollback() }()

	var questionID, cause string
	if err := transaction.QueryRowContext(ctx,
		`SELECT question_id, cause FROM question_attempts WHERE id = ?`, attemptID,
	).Scan(&questionID, &cause); err != nil {
		return models.Mistake{}, mapNotFound(err, "mistake")
	}
	if strings.TrimSpace(cause) == "" {
		return models.Mistake{}, fmt.Errorf("mistake %q is not a filed attempt", attemptID)
	}
	if _, err := transaction.ExecContext(ctx, `
		INSERT INTO question_attempts(id, question_id, cause, note, answer, elapsed_ms, is_correct, occurred_at)
		SELECT ?, ?, '', '', ?, ?, 1, ?
		WHERE NOT EXISTS (
			SELECT 1 FROM question_attempts WHERE question_id = ? AND is_correct = 1
		)`,
		newMistakeID("qa"), questionID, answer, input.ElapsedMS, formatTime(occurredAt), questionID,
	); err != nil {
		return models.Mistake{}, err
	}
	if err := transaction.Commit(); err != nil {
		return models.Mistake{}, err
	}
	return s.GetMistake(ctx, attemptID)
}

// CorrectMistake keeps the pre-evidence store API usable for older callers.
// New code should call RecordMistakeCorrection so the retry carries evidence.
func (s *Store) CorrectMistake(ctx context.Context, attemptID string) (models.Mistake, error) {
	return s.recordMistakeCorrection(ctx, attemptID, models.MistakeCorrectionInput{}, true)
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

// UpdateMistakeEvidence replaces the subject-specific artifact for one
// question attempt. It deliberately returns the full pair so list/detail
// callers and the editor share one response shape.
func (s *Store) UpdateMistakeEvidence(ctx context.Context, attemptID string, raw json.RawMessage) (models.Mistake, error) {
	transaction, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return models.Mistake{}, err
	}
	defer func() { _ = transaction.Rollback() }()

	var subject string
	if err := transaction.QueryRowContext(ctx, `
		SELECT q.subject FROM question_attempts a JOIN questions q ON q.id = a.question_id WHERE a.id = ?`, attemptID,
	).Scan(&subject); err != nil {
		return models.Mistake{}, mapNotFound(err, "mistake")
	}
	evidence, err := models.NormalizeSubjectAttemptEvidence(subject, raw)
	if err != nil {
		return models.Mistake{}, fmt.Errorf("%w: %v", ErrInvalidMistakeEvidence, err)
	}
	if _, err := transaction.ExecContext(ctx, `UPDATE question_attempts SET evidence_json = ? WHERE id = ?`, evidence, attemptID); err != nil {
		return models.Mistake{}, err
	}
	if err := transaction.Commit(); err != nil {
		return models.Mistake{}, err
	}
	return s.GetMistake(ctx, attemptID)
}

func scanMistake(row scanner) (models.Mistake, error) {
	var mistake models.Mistake
	var evidence, occurredAt, createdAt string
	if err := row.Scan(
		&mistake.Attempt.ID, &mistake.Attempt.QuestionID, &mistake.Attempt.Cause, &mistake.Attempt.Note,
		&mistake.Attempt.Answer, &mistake.Attempt.ElapsedMS, &mistake.Attempt.IsCorrect, &evidence, &occurredAt,
		&mistake.Question.Subject, &mistake.Question.Stem, &mistake.Question.SourceID,
		&mistake.Question.KnowledgeItemID, &createdAt, &mistake.Corrected,
	); err != nil {
		return models.Mistake{}, err
	}
	mistake.Attempt.EvidenceJSON = json.RawMessage(evidence)
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

func (s *Store) attachMistakeCorrection(ctx context.Context, mistake *models.Mistake) error {
	var correction models.QuestionAttempt
	var evidence, occurredAt string
	err := s.db.QueryRowContext(ctx, `
		SELECT id, question_id, cause, note, answer, elapsed_ms, is_correct, evidence_json, occurred_at
		FROM question_attempts
		WHERE question_id = ? AND is_correct = 1
		ORDER BY occurred_at DESC, id DESC
		LIMIT 1`, mistake.Question.ID).Scan(
		&correction.ID, &correction.QuestionID, &correction.Cause, &correction.Note,
		&correction.Answer, &correction.ElapsedMS, &correction.IsCorrect, &evidence, &occurredAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		mistake.Correction = nil
		mistake.Corrected = false
		return nil
	}
	if err != nil {
		return err
	}
	correction.EvidenceJSON = json.RawMessage(evidence)
	parsed, err := parseTime(occurredAt)
	if err != nil {
		return err
	}
	correction.OccurredAt = parsed
	mistake.Correction = &correction
	mistake.Corrected = true
	return nil
}
