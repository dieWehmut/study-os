package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/open-spaced-repetition/go-fsrs/v3"

	"study-os/backend/app"
	"study-os/backend/db"
	"study-os/backend/memory"
	"study-os/backend/models"
)

// handleKnowledgeSchedule puts an already-filed knowledge item into the review
// queue.
//
// 收进知识库 and the home page's 暂存 box both write a knowledge item and stop.
// The due query joins review_states, so an item carrying no prompts can never
// match it -- without this endpoint everything 预习 produces sits in the
// library permanently, visible in the counts and unreachable by 复习.
//
// The prompts come from the item's own words via memory.GeneratePrompts, which
// is offline and deterministic: no model sees the item, and the same item
// always yields the same questions.
func handleKnowledgeSchedule(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	ctx := request.Context()
	item, err := application.Store.GetKnowledgeItem(ctx, chi.URLParam(request, "knowledgeID"))
	if err != nil {
		writeStoreError(response, err)
		return
	}

	// There is no undo in the review queue, so a second press must not hand you
	// the same card twice for the rest of the item's life. Answered with 200
	// rather than a conflict: nothing went wrong, the item is already where the
	// caller wants it.
	existing, err := scheduledPromptCount(ctx, application.Store, item.ID)
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "读取复习安排失败"})
		return
	}
	if existing > 0 {
		writeJSON(response, http.StatusOK, map[string]any{
			"status":       "already_scheduled",
			"knowledge_id": item.ID,
			"prompt_count": existing,
		})
		return
	}

	generated := memory.GeneratePrompts(memory.KnowledgeItem{
		ID:                item.ID,
		ItemType:          item.ItemType,
		Subject:           item.Subject,
		Term:              item.Term,
		ConciseDefinition: item.ConciseDefinition,
		Example:           item.Example,
		AcceptedMeanings:  []string{item.ConciseDefinition},
		AcceptedTerms:     []string{item.Term},
	})

	now := time.Now().UTC()
	// Due a moment ago rather than exactly now: the queue asks for cards due at
	// or before the request time, and a card stamped with the same instant can
	// lose that race against the clock.
	dueAt := now.Add(-time.Second)

	err = application.Store.WithTx(ctx, func(tx *db.TxStore) error {
		for index, generatedPrompt := range generated {
			prompt := models.Prompt{
				ID:              fmt.Sprintf("p-%s-%d", item.ID, index+1),
				KnowledgeItemID: item.ID,
				PromptType:      string(generatedPrompt.Type),
				Question:        generatedPrompt.Question,
				AcceptedAnswers: generatedPrompt.AcceptedAnswers,
				CreatedAt:       now,
				UpdatedAt:       now,
			}
			if err := tx.CreatePrompt(ctx, prompt); err != nil {
				return err
			}
			card := fsrs.NewCard()
			card.Due = dueAt
			cardJSON, err := json.Marshal(card)
			if err != nil {
				return fmt.Errorf("encode card: %w", err)
			}
			// The prompt and its schedule are written together so "has prompts"
			// and "is in the queue" can never disagree -- which is what makes
			// the count above a sound idempotency check.
			if err := tx.UpsertReviewState(ctx, models.ReviewState{
				PromptID:  prompt.ID,
				CardJSON:  cardJSON,
				DueAt:     dueAt,
				UpdatedAt: now,
			}); err != nil {
				return err
			}
		}
		payload, err := json.Marshal(map[string]any{"prompt_count": len(generated)})
		if err != nil {
			return fmt.Errorf("encode schedule event: %w", err)
		}
		return tx.AppendDomainEvent(ctx, models.DomainEvent{
			ID:          newRequestID("event-schedule"),
			EventType:   "knowledge_scheduled",
			AggregateID: item.ID,
			PayloadJSON: payload,
			OccurredAt:  now,
		})
	})
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "安排复习失败"})
		return
	}

	writeJSON(response, http.StatusCreated, map[string]any{
		"status":       "scheduled",
		"knowledge_id": item.ID,
		"prompt_count": len(generated),
	})
}

// scheduledPromptCount answers how many cards this item already contributes to
// the queue.
func scheduledPromptCount(ctx context.Context, store *db.Store, knowledgeID string) (int, error) {
	var count int
	err := store.SQL().QueryRowContext(ctx,
		`SELECT COUNT(*) FROM prompts WHERE knowledge_item_id = ?`, knowledgeID).Scan(&count)
	return count, err
}
