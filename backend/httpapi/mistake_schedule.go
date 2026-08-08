package httpapi

import (
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

// handleMistakeSchedule turns one filed mistake into a review card.
//
// 想不起来 is the one cause more review actually fixes, and until this existed
// the Practice page could only say so. The queue joins review_states through
// prompts, which hang off a knowledge item, so a filed mistake stays invisible
// to 复习 until the question becomes one.
//
// The refusal below is the point of the whole feature. Every other path in
// this app answers a wrong answer with "see it again sooner"; for five of the
// six causes that reshuffles something which was never the problem.
func handleMistakeSchedule(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	ctx := request.Context()
	mistake, err := application.Store.GetMistake(ctx, chi.URLParam(request, "attemptID"))
	if err != nil {
		writeStoreError(response, err)
		return
	}

	if !memory.ReviewFixes(mistake.Attempt.Cause) {
		writeJSON(response, http.StatusBadRequest, map[string]string{
			"error": "这类错误再复习一遍也不会好，先按它自己的办法处理",
		})
		return
	}

	// The question carries the id of the item it became, so a second press can
	// tell it already did this. Answered 200 rather than a conflict: nothing
	// went wrong, the mistake is already where the caller wants it.
	if mistake.Question.KnowledgeItemID != "" {
		existing, err := scheduledPromptCount(ctx, application.Store, mistake.Question.KnowledgeItemID)
		if err != nil {
			writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "读取复习安排失败"})
			return
		}
		writeJSON(response, http.StatusOK, map[string]any{
			"status":       "already_scheduled",
			"knowledge_id": mistake.Question.KnowledgeItemID,
			"prompt_count": existing,
		})
		return
	}

	now := time.Now().UTC()
	// Due a moment ago rather than exactly now: the queue asks for cards due at
	// or before the request time, and a card stamped with the same instant can
	// lose that race against the clock.
	dueAt := now.Add(-time.Second)

	// The stem becomes the term and the note the definition, which is what
	// GenerateMistakePrompts reads. Filed as its own item type so the library
	// can tell a 错题 from a 词条 -- they are read for different reasons.
	item := models.KnowledgeItem{
		ID:                newRequestID("k-mistake"),
		ItemType:          "mistake",
		Subject:           mistake.Question.Subject,
		Term:              mistake.Question.Stem,
		ConciseDefinition: mistake.Attempt.Note,
		CreatedAt:         now,
		UpdatedAt:         now,
	}
	generated := memory.GenerateMistakePrompts(memory.KnowledgeItem{
		ID:                item.ID,
		ItemType:          item.ItemType,
		Subject:           item.Subject,
		Term:              item.Term,
		ConciseDefinition: item.ConciseDefinition,
	})
	if len(generated) == 0 {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "这道错题没有题干，排不进复习"})
		return
	}

	err = application.Store.WithTx(ctx, func(tx *db.TxStore) error {
		if err := tx.CreateKnowledgeItem(ctx, item); err != nil {
			return err
		}
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
			if err := tx.UpsertReviewState(ctx, models.ReviewState{
				PromptID:  prompt.ID,
				CardJSON:  cardJSON,
				DueAt:     dueAt,
				UpdatedAt: now,
			}); err != nil {
				return err
			}
		}
		// Written in the same transaction as the item it names: a link that
		// could outlive its item would hide the button on a row whose card was
		// never created.
		if err := tx.LinkQuestionToKnowledge(ctx, mistake.Question.ID, item.ID); err != nil {
			return err
		}
		payload, err := json.Marshal(map[string]any{
			"knowledge_id": item.ID,
			"cause":        mistake.Attempt.Cause,
			"prompt_count": len(generated),
		})
		if err != nil {
			return fmt.Errorf("encode schedule event: %w", err)
		}
		return tx.AppendDomainEvent(ctx, models.DomainEvent{
			ID:          newRequestID("event-mistake-schedule"),
			EventType:   "mistake_scheduled",
			AggregateID: mistake.Question.ID,
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
