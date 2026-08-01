package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	fsrs "github.com/open-spaced-repetition/go-fsrs/v3"

	"study-os/backend/app"
	"study-os/backend/db"
	"study-os/backend/memory"
	"study-os/backend/models"
)

var requestID atomic.Uint64

func NewRouter(application *app.App) http.Handler {
	router := chi.NewRouter()
	router.Use(middleware.Recoverer)
	router.Use(loopbackHostOnly)
	router.Route("/api", func(api chi.Router) {
		api.Get("/health", func(response http.ResponseWriter, request *http.Request) {
			if application == nil || application.Store == nil {
				writeJSON(response, http.StatusServiceUnavailable, map[string]string{"status": "unavailable"})
				return
			}
			if err := application.Store.SQL().PingContext(request.Context()); err != nil {
				writeJSON(response, http.StatusServiceUnavailable, map[string]string{"status": "unavailable"})
				return
			}
			writeJSON(response, http.StatusOK, map[string]string{"status": "ok"})
		})
		api.Post("/demo/seed", func(response http.ResponseWriter, request *http.Request) {
			handleDemoSeed(response, request, application)
		})
		api.Get("/reviews/due", func(response http.ResponseWriter, request *http.Request) {
			handleDueReviews(response, request, application)
		})
		api.Post("/reviews/{promptID}/answer", func(response http.ResponseWriter, request *http.Request) {
			handleAnswer(response, request, application)
		})
		api.Post("/attempts/{attemptID}/override", func(response http.ResponseWriter, request *http.Request) {
			handleOverride(response, request, application)
		})
		api.Get("/dashboard", func(response http.ResponseWriter, request *http.Request) {
			handleDashboard(response, request, application)
		})
	})
	return router
}

type reviewPromptResponse struct {
	ID              string `json:"id"`
	KnowledgeItemID string `json:"knowledge_item_id"`
	PromptType      string `json:"prompt_type"`
	Question        string `json:"question"`
}

// reviewKnowledgeResponse contains only metadata needed before answering.
// Definition, term, Wiki text, and examples can otherwise reveal the answer.
type reviewKnowledgeResponse struct {
	ID            string   `json:"id"`
	ItemType      string   `json:"item_type"`
	PartOfSpeech  string   `json:"part_of_speech,omitempty"`
	Pronunciation string   `json:"pronunciation,omitempty"`
	Level         string   `json:"level,omitempty"`
	Tags          []string `json:"tags,omitempty"`
}

type reviewItemResponse struct {
	Prompt    reviewPromptResponse    `json:"prompt"`
	Knowledge reviewKnowledgeResponse `json:"knowledge"`
	DueAt     time.Time               `json:"due_at"`
}

type answerRequest struct {
	Answer      string `json:"answer"`
	Familiarity *int   `json:"familiarity"`
}

type answerResponse struct {
	AttemptID       string    `json:"attempt_id"`
	Outcome         string    `json:"outcome"`
	Rating          int       `json:"rating"`
	Feedback        string    `json:"feedback"`
	DueAt           time.Time `json:"due_at"`
	ExpectedAnswers []string  `json:"expected_answers"`
}

func handleDemoSeed(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	ctx := request.Context()
	const knowledgeID = "demo-knowledge-abandon"
	const promptPrefix = "demo-prompt-abandon-"
	if demoSeedExists(ctx, application.Store, knowledgeID) {
		writeJSON(response, http.StatusOK, map[string]any{
			"status":       "already_seeded",
			"knowledge_id": knowledgeID,
			"prompt_count": 3,
		})
		return
	}

	now := time.Now().UTC()
	item := models.KnowledgeItem{
		ID:                knowledgeID,
		ItemType:          "word_sense",
		Term:              "abandon",
		PartOfSpeech:      "verb",
		ConciseDefinition: "\u653e\u5f03\uff1b\u62cb\u5f03",
		DetailedMarkdown:  "## abandon\n\nTo leave something or someone behind.",
		Example:           "They had to abandon the damaged car.",
		Level:             "CET4",
		Tags:              []string{"demo", "english"},
		CreatedAt:         now,
		UpdatedAt:         now,
	}
	generated := memory.GeneratePrompts(memory.KnowledgeItem{
		ID:                item.ID,
		Term:              item.Term,
		ConciseDefinition: item.ConciseDefinition,
		Example:           item.Example,
		AcceptedMeanings:  []string{item.ConciseDefinition},
		AcceptedTerms:     []string{item.Term},
	})
	dueAt := now.Add(-time.Second)

	err := application.Store.WithTx(ctx, func(tx *db.TxStore) error {
		if err := tx.CreateKnowledgeItem(ctx, item); err != nil {
			return err
		}
		for index, generatedPrompt := range generated {
			prompt := models.Prompt{
				ID:              fmt.Sprintf("%s%d", promptPrefix, index+1),
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
				return fmt.Errorf("encode demo card: %w", err)
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
		return tx.AppendDomainEvent(ctx, models.DomainEvent{
			ID:          newRequestID("event-demo-seed"),
			EventType:   "demo_seeded",
			AggregateID: item.ID,
			PayloadJSON: json.RawMessage(`{"prompt_count":3}`),
			OccurredAt:  now,
		})
	})
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(response, http.StatusCreated, map[string]any{
		"status":       "seeded",
		"knowledge_id": item.ID,
		"prompt_count": len(generated),
	})
}

func handleDueReviews(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	limit := parseLimit(request.URL.Query().Get("limit"), 20, 100)
	prompts, err := application.Store.DuePrompts(request.Context(), time.Now().UTC(), limit)
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	items := make([]reviewItemResponse, 0, len(prompts))
	for _, prompt := range prompts {
		item, itemErr := application.Store.GetKnowledgeItem(request.Context(), prompt.KnowledgeItemID)
		if itemErr != nil {
			writeJSON(response, http.StatusInternalServerError, map[string]string{"error": itemErr.Error()})
			return
		}
		state, stateErr := application.Store.GetReviewState(request.Context(), prompt.ID)
		if stateErr != nil {
			writeJSON(response, http.StatusInternalServerError, map[string]string{"error": stateErr.Error()})
			return
		}
		items = append(items, reviewItemResponse{
			Prompt: reviewPromptResponse{
				ID:              prompt.ID,
				KnowledgeItemID: prompt.KnowledgeItemID,
				PromptType:      prompt.PromptType,
				Question:        prompt.Question,
			},
			Knowledge: reviewKnowledgeResponse{
				ID:            item.ID,
				ItemType:      item.ItemType,
				PartOfSpeech:  item.PartOfSpeech,
				Pronunciation: item.Pronunciation,
				Level:         item.Level,
				Tags:          item.Tags,
			},
			DueAt: state.DueAt,
		})
	}
	writeJSON(response, http.StatusOK, map[string]any{"items": items, "count": len(items)})
}

func handleAnswer(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	var input answerRequest
	if err := decodeRequest(request, &input); err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if input.Familiarity != nil && (*input.Familiarity < 1 || *input.Familiarity > 5) {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "familiarity must be between 1 and 5"})
		return
	}
	promptID := chi.URLParam(request, "promptID")
	prompt, err := application.Store.GetPrompt(request.Context(), promptID)
	if err != nil {
		writeStoreError(response, err)
		return
	}
	state, err := application.Store.GetReviewState(request.Context(), promptID)
	if err != nil {
		writeStoreError(response, err)
		return
	}
	var before fsrs.Card
	if err := json.Unmarshal(state.CardJSON, &before); err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "invalid review card"})
		return
	}
	evaluation := memory.EvaluateAnswer(input.Answer, prompt.AcceptedAnswers)
	now := time.Now().UTC()
	after := memory.Schedule(before, now, evaluation.Rating)
	priorCard, _ := json.Marshal(before)
	afterCard, _ := json.Marshal(after)
	attempt := models.Attempt{
		ID:                  newRequestID("attempt"),
		PromptID:            prompt.ID,
		Answer:              input.Answer,
		OriginalEvaluation:  string(evaluation.Outcome),
		EffectiveEvaluation: string(evaluation.Outcome),
		Feedback:            evaluation.Feedback,
		SchedulerRating:     int(evaluation.Rating),
		PriorCardJSON:       priorCard,
		Familiarity:         input.Familiarity,
		CreatedAt:           now,
		UpdatedAt:           now,
	}
	err = application.Store.WithTx(request.Context(), func(tx *db.TxStore) error {
		if err := tx.CreateAttempt(request.Context(), attempt); err != nil {
			return err
		}
		if err := tx.UpsertReviewState(request.Context(), models.ReviewState{
			PromptID: prompt.ID, CardJSON: afterCard, DueAt: after.Due, UpdatedAt: now,
		}); err != nil {
			return err
		}
		return tx.AppendDomainEvent(request.Context(), models.DomainEvent{
			ID: newRequestID("event-attempt"), EventType: "attempt_recorded", AggregateID: attempt.ID,
			PayloadJSON: json.RawMessage(fmt.Sprintf(`{"outcome":%q,"rating":%d}`, evaluation.Outcome, evaluation.Rating)),
			OccurredAt:  now,
		})
	})
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(response, http.StatusOK, answerResponse{
		AttemptID:       attempt.ID,
		Outcome:         string(evaluation.Outcome),
		Rating:          int(evaluation.Rating),
		Feedback:        evaluation.Feedback,
		DueAt:           after.Due,
		ExpectedAnswers: prompt.AcceptedAnswers,
	})
}

func handleOverride(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	var input struct {
		Rating int `json:"rating"`
	}
	if err := decodeRequest(request, &input); err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if input.Rating < int(memory.RatingAgain) || input.Rating > int(memory.RatingGood) {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "rating must be 1, 2, or 3"})
		return
	}
	attemptID := chi.URLParam(request, "attemptID")
	attempt, err := application.Store.GetAttempt(request.Context(), attemptID)
	if err != nil {
		writeStoreError(response, err)
		return
	}
	state, err := application.Store.GetReviewState(request.Context(), attempt.PromptID)
	if err != nil {
		writeStoreError(response, err)
		return
	}
	var before, current fsrs.Card
	if err := json.Unmarshal(attempt.PriorCardJSON, &before); err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "invalid prior review card"})
		return
	}
	if err := json.Unmarshal(state.CardJSON, &current); err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "invalid current review card"})
		return
	}
	prompt, err := application.Store.GetPrompt(request.Context(), attempt.PromptID)
	if err != nil {
		writeStoreError(response, err)
		return
	}
	now := time.Now().UTC()
	rating := memory.Rating(input.Rating)
	after := memory.OverrideSchedule(before, now, current, rating)
	afterCard, _ := json.Marshal(after)
	outcome, feedback := overrideOutcome(rating)
	attempt.EffectiveEvaluation = string(outcome)
	attempt.Feedback = feedback
	attempt.SchedulerRating = input.Rating
	attempt.UpdatedAt = now
	err = application.Store.WithTx(request.Context(), func(tx *db.TxStore) error {
		if err := tx.UpdateAttempt(request.Context(), attempt); err != nil {
			return err
		}
		if err := tx.UpsertReviewState(request.Context(), models.ReviewState{
			PromptID: attempt.PromptID, CardJSON: afterCard, DueAt: after.Due, UpdatedAt: now,
		}); err != nil {
			return err
		}
		return tx.AppendDomainEvent(request.Context(), models.DomainEvent{
			ID: newRequestID("event-override"), EventType: "attempt_overridden", AggregateID: attempt.ID,
			PayloadJSON: json.RawMessage(fmt.Sprintf(`{"outcome":%q,"rating":%d}`, outcome, rating)),
			OccurredAt:  now,
		})
	})
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(response, http.StatusOK, answerResponse{
		AttemptID:       attempt.ID,
		Outcome:         string(outcome),
		Rating:          input.Rating,
		Feedback:        feedback,
		DueAt:           after.Due,
		ExpectedAnswers: prompt.AcceptedAnswers,
	})
}

func handleDashboard(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	var knowledgeCount, promptCount, attemptCount, dueCount, reviewedToday int
	database := application.Store.SQL()
	ctx := request.Context()
	if err := database.QueryRowContext(ctx, `SELECT COUNT(*) FROM knowledge_items`).Scan(&knowledgeCount); err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if err := database.QueryRowContext(ctx, `SELECT COUNT(*) FROM attempts`).Scan(&attemptCount); err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if err := database.QueryRowContext(ctx, `SELECT COUNT(*) FROM prompts`).Scan(&promptCount); err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if err := database.QueryRowContext(ctx, `SELECT COUNT(*) FROM review_states WHERE due_at <= ?`, formatHTTPTime(time.Now().UTC())).Scan(&dueCount); err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	dayStart := time.Now().UTC().Truncate(24 * time.Hour)
	if err := database.QueryRowContext(ctx, `SELECT COUNT(*) FROM attempts WHERE created_at >= ?`, formatHTTPTime(dayStart)).Scan(&reviewedToday); err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	currentStreak := 0
	if reviewedToday > 0 {
		currentStreak = 1
	}
	writeJSON(response, http.StatusOK, map[string]any{
		"knowledge_count": knowledgeCount,
		"prompt_count":    promptCount,
		"attempt_count":   attemptCount,
		"due_count":       dueCount,
		"reviewed_today":  reviewedToday,
		"current_streak":  currentStreak,
		"provider":        application.Config.AIProvider,
		"offline":         application.Config.AIProvider == "mock",
	})
}

func demoSeedExists(ctx context.Context, store *db.Store, knowledgeID string) bool {
	var count int
	if err := store.SQL().QueryRowContext(ctx, `SELECT COUNT(*) FROM knowledge_items WHERE id = ?`, knowledgeID).Scan(&count); err != nil {
		return false
	}
	return count > 0
}

func decodeRequest(request *http.Request, target any) error {
	decoder := json.NewDecoder(request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return fmt.Errorf("decode JSON request: %w", err)
	}
	return nil
}

func parseLimit(value string, fallback, maximum int) int {
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed < 1 {
		return fallback
	}
	if parsed > maximum {
		return maximum
	}
	return parsed
}

func writeStoreError(response http.ResponseWriter, err error) {
	if errors.Is(err, db.ErrNotFound) {
		writeJSON(response, http.StatusNotFound, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(response, http.StatusInternalServerError, map[string]string{"error": err.Error()})
}

func overrideOutcome(rating memory.Rating) (memory.Outcome, string) {
	switch rating {
	case memory.RatingGood:
		return memory.OutcomeCorrect, "已按你的修正记为正确，并重新安排复习。"
	case memory.RatingHard:
		return memory.OutcomePartial, "已按你的修正记为部分掌握，并重新安排复习。"
	default:
		return memory.OutcomeIncorrect, "已按你的修正记为未掌握，并重新安排复习。"
	}
}

func newRequestID(prefix string) string {
	sequence := requestID.Add(1)
	var random [4]byte
	_, _ = rand.Read(random[:])
	return fmt.Sprintf("%s-%d-%x", prefix, sequence, random)
}

func formatHTTPTime(value time.Time) string {
	return value.UTC().Format(time.RFC3339Nano)
}

func loopbackHostOnly(next http.Handler) http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if !isLoopbackHost(request.Host) {
			http.Error(response, "loopback host required", http.StatusMisdirectedRequest)
			return
		}
		next.ServeHTTP(response, request)
	})
}

func isLoopbackHost(hostPort string) bool {
	host := strings.TrimSpace(hostPort)
	if splitHost, _, err := net.SplitHostPort(host); err == nil {
		host = splitHost
	} else {
		host = strings.Trim(host, "[]")
	}
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func writeJSON(response http.ResponseWriter, status int, value any) {
	response.Header().Set("Content-Type", "application/json; charset=utf-8")
	response.WriteHeader(status)
	_ = json.NewEncoder(response).Encode(value)
}
