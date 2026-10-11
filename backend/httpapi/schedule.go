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
	existing, err := scheduledStateCount(ctx, application.Store, item.ID)
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

	// Cards that are already there are reused rather than recreated. Their ids are
	// deterministic (`p-<itemID>-<n>`), so creating them again would collide -- and
	// re-scheduling after 取消排复习 lands exactly here: the cards were left standing and
	// only their schedules were removed.
	existingPrompts, err := application.Store.ReviewPromptIDs(ctx, item.ID)
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "读取复习卡失败"})
		return
	}

	now := time.Now().UTC()
	// Due a moment ago rather than exactly now: the queue asks for cards due at
	// or before the request time, and a card stamped with the same instant can
	// lose that race against the clock.
	dueAt := now.Add(-time.Second)

	// Counted inside the transaction, from the ids that are actually scheduled: the
	// response is read by callers that show 「N 张卡」, and a number computed before the
	// work is done is a number that can be wrong about the work.
	scheduled := 0

	err = application.Store.WithTx(ctx, func(tx *db.TxStore) error {
		promptIDs := existingPrompts
		if len(promptIDs) == 0 {
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
				promptIDs = append(promptIDs, prompt.ID)
			}
		}
		scheduled = len(promptIDs)
		for _, promptID := range promptIDs {
			card := fsrs.NewCard()
			card.Due = dueAt
			cardJSON, err := json.Marshal(card)
			if err != nil {
				return fmt.Errorf("encode card: %w", err)
			}
			// The card and its schedule are written together so "has a schedule"
			// and "is in the queue" can never disagree -- which is what makes
			// the count above a sound idempotency check.
			if err := tx.UpsertReviewState(ctx, models.ReviewState{
				PromptID:  promptID,
				CardJSON:  cardJSON,
				DueAt:     dueAt,
				UpdatedAt: now,
			}); err != nil {
				return err
			}
		}
		payload, err := json.Marshal(map[string]any{"prompt_count": scheduled})
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
		"prompt_count": scheduled,
	})
}

// handleKnowledgeUnschedule is the way back out of the queue.
//
// It exists because 排进复习 was a one-way door: a reader who pressed it by mistake, or
// who decided a word is not worth drilling, had no way to say so. What it removes is the
// *plan* -- the review states -- and what it leaves standing is the cards and the
// attempts, because a prompt that was ever answered cannot be deleted at all
// (`attempts.prompt_id REFERENCES prompts(id) ON DELETE RESTRICT`) and history is what
// that constraint is protecting. Cards left behind are not litter: 排进复习 reuses them,
// which is what makes the round trip work for an item that has ever been reviewed.
func handleKnowledgeUnschedule(response http.ResponseWriter, request *http.Request, application *app.App) {
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

	now := time.Now().UTC()
	var removed int
	err = application.Store.WithTx(ctx, func(tx *db.TxStore) error {
		count, removeErr := tx.RemoveReviewSchedule(ctx, item.ID)
		if removeErr != nil {
			return removeErr
		}
		removed = count
		payload, marshalErr := json.Marshal(map[string]any{"prompts_removed": count})
		if marshalErr != nil {
			return fmt.Errorf("encode unschedule event: %w", marshalErr)
		}
		return tx.AppendDomainEvent(ctx, models.DomainEvent{
			ID:          newRequestID("event-unschedule"),
			EventType:   "knowledge_unscheduled",
			AggregateID: item.ID,
			PayloadJSON: payload,
			OccurredAt:  now,
		})
	})
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "取消复习安排失败"})
		return
	}

	// 200 whether or not anything was there: nothing went wrong, and the item is out of
	// the queue -- the same reasoning the schedule side uses for its repeat press.
	writeJSON(response, http.StatusOK, map[string]any{
		"status":          "unscheduled",
		"knowledge_id":    item.ID,
		"prompts_removed": removed,
	})
}

// scheduledStateCount answers how many cards this item currently contributes to the
// queue.
//
// It counts review STATES, not prompts. That is what "in the queue" means here, and the
// difference matters the moment 取消排复习 exists: that undo removes the schedules and
// leaves the prompts in place (a prompt that was ever answered cannot be deleted --
// `attempts.prompt_id REFERENCES prompts(id) ON DELETE RESTRICT`), so a count of prompts
// would keep answering 「already_scheduled」 for an item that is not in the queue at all.
func scheduledStateCount(ctx context.Context, store *db.Store, knowledgeID string) (int, error) {
	var count int
	err := store.SQL().QueryRowContext(ctx, `
		SELECT COUNT(*) FROM review_states rs
		JOIN prompts p ON p.id = rs.prompt_id
		WHERE p.knowledge_item_id = ?`, knowledgeID).Scan(&count)
	return count, err
}
