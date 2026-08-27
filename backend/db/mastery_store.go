package db

import (
	"context"
	"database/sql"
	"fmt"
	"sort"
	"time"

	"study-os/backend/models"
)

type masteryPromptAccumulator struct {
	snapshot        models.EnglishMasteryPromptSnapshot
	latestAttemptID string
}

// GetKnowledgeMastery projects the existing prompt-level review history for
// one knowledge item. It stores no second mastery state of its own.
func (s *Store) GetKnowledgeMastery(ctx context.Context, knowledgeItemID string) (models.EnglishMasteryProjection, error) {
	item, err := s.GetKnowledgeItem(ctx, knowledgeItemID)
	if err != nil {
		return models.EnglishMasteryProjection{}, err
	}

	rows, err := s.db.QueryContext(ctx, `
		SELECT p.id, p.prompt_type, rs.due_at,
			a.id, a.answer, a.effective_evaluation, a.created_at
		FROM prompts AS p
		LEFT JOIN review_states AS rs ON rs.prompt_id = p.id
		LEFT JOIN attempts AS a ON a.prompt_id = p.id
		WHERE p.knowledge_item_id = ?`, item.ID)
	if err != nil {
		return models.EnglishMasteryProjection{}, fmt.Errorf("query knowledge mastery %q: %w", item.ID, err)
	}
	defer rows.Close()

	byPromptID := make(map[string]*masteryPromptAccumulator)
	for rows.Next() {
		var promptID, promptType string
		var dueAt, attemptID, answer, evaluation, attemptedAt sql.NullString
		if err := rows.Scan(&promptID, &promptType, &dueAt, &attemptID, &answer, &evaluation, &attemptedAt); err != nil {
			return models.EnglishMasteryProjection{}, fmt.Errorf("scan knowledge mastery %q: %w", item.ID, err)
		}

		entry := byPromptID[promptID]
		if entry == nil {
			entry = &masteryPromptAccumulator{snapshot: models.EnglishMasteryPromptSnapshot{
				PromptID:   promptID,
				PromptType: promptType,
			}}
			if dueAt.Valid {
				parsed, parseErr := parseTime(dueAt.String)
				if parseErr != nil {
					return models.EnglishMasteryProjection{}, fmt.Errorf("parse mastery due time for %q: %w", promptID, parseErr)
				}
				entry.snapshot.DueAt = &parsed
			}
			byPromptID[promptID] = entry
		}

		if !attemptID.Valid {
			continue
		}
		entry.snapshot.AttemptCount++
		parsedAttemptAt, parseErr := parseTime(attemptedAt.String)
		if parseErr != nil {
			return models.EnglishMasteryProjection{}, fmt.Errorf("parse mastery attempt time for %q: %w", attemptID.String, parseErr)
		}
		if !laterMasteryAttempt(parsedAttemptAt, attemptID.String, entry.snapshot.LastAttemptAt, entry.latestAttemptID) {
			continue
		}
		entry.snapshot.LatestAnswer = answer.String
		entry.snapshot.LatestEffectiveEvaluation = evaluation.String
		entry.snapshot.LastAttemptAt = &parsedAttemptAt
		entry.latestAttemptID = attemptID.String
	}
	if err := rows.Err(); err != nil {
		return models.EnglishMasteryProjection{}, fmt.Errorf("iterate knowledge mastery %q: %w", item.ID, err)
	}

	promptIDs := make([]string, 0, len(byPromptID))
	for promptID := range byPromptID {
		promptIDs = append(promptIDs, promptID)
	}
	sort.Strings(promptIDs)
	snapshots := make([]models.EnglishMasteryPromptSnapshot, 0, len(promptIDs))
	for _, promptID := range promptIDs {
		snapshots = append(snapshots, byPromptID[promptID].snapshot)
	}
	return models.BuildEnglishMasteryProjection(item.ID, item.Subject, snapshots), nil
}

func laterMasteryAttempt(candidateAt time.Time, candidateID string, currentAt *time.Time, currentID string) bool {
	if currentAt == nil {
		return true
	}
	if candidateAt.Equal(*currentAt) {
		return candidateID > currentID
	}
	return candidateAt.After(*currentAt)
}
