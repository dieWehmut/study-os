package httpapi

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	fsrs "github.com/open-spaced-repetition/go-fsrs/v3"

	"study-os/backend/agent"
	"study-os/backend/app"
	"study-os/backend/backup"
	"study-os/backend/db"
	"study-os/backend/importer"
	"study-os/backend/memory"
	"study-os/backend/models"
)

var requestID atomic.Uint64

const maxImportJSONBytes int64 = 64 << 10

func NewRouter(application *app.App) http.Handler {
	router := chi.NewRouter()
	router.Use(middleware.Recoverer)
	router.Use(loopbackHostOnly)
	router.Use(trustedOriginOnly)
	if application != nil && application.Launcher != nil {
		router.Use(func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
				application.Launcher.Touch()
				next.ServeHTTP(response, request)
			})
		})
	}
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
		api.Get("/system/status", func(response http.ResponseWriter, request *http.Request) {
			handleSystemStatus(response, request, application)
		})
		api.Patch("/settings", func(response http.ResponseWriter, request *http.Request) {
			handleSettingsPatch(response, request, application)
		})
		api.Get("/agent/status", func(response http.ResponseWriter, request *http.Request) {
			handleAgentStatus(response, request, application)
		})
		api.Get("/agent/vendors", func(response http.ResponseWriter, request *http.Request) {
			handleAgentVendors(response, request, application)
		})
		api.Patch("/agent/active", func(response http.ResponseWriter, request *http.Request) {
			handleAgentActive(response, request, application)
		})
		api.Patch("/agent/config", func(response http.ResponseWriter, request *http.Request) {
			handleAgentConfig(response, request, application)
		})
		api.Post("/agent/test", func(response http.ResponseWriter, request *http.Request) {
			handleAgentTest(response, request, application)
		})
		api.Get("/update/status", func(response http.ResponseWriter, request *http.Request) {
			handleUpdateStatus(response, request, application)
		})
		api.Post("/agent/generate", func(response http.ResponseWriter, request *http.Request) {
			handleAgentGenerate(response, request, application)
		})
		api.Get("/audio", func(response http.ResponseWriter, request *http.Request) {
			handleAudio(response, request, application)
		})
		api.Post("/audio", func(response http.ResponseWriter, request *http.Request) {
			handleAudioGenerate(response, request, application)
		})
		api.Get("/audio/timeline", func(response http.ResponseWriter, request *http.Request) {
			handleAudioTimeline(response, request, application)
		})
		api.Get("/groups", func(response http.ResponseWriter, request *http.Request) {
			handleGroups(response, request, application)
		})
		api.Post("/english/process", func(response http.ResponseWriter, request *http.Request) {
			handleEnglishProcess(response, request, application)
		})
		api.Post("/english/wiki", func(response http.ResponseWriter, request *http.Request) {
			handleEnglishWiki(response, request, application)
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
		api.Post("/imports", func(response http.ResponseWriter, request *http.Request) {
			handleImportUpload(response, request, application)
		})
		api.Get("/imports/{importID}", func(response http.ResponseWriter, request *http.Request) {
			handleImportGet(response, request, application)
		})
		api.Post("/imports/{importID}/preview", func(response http.ResponseWriter, request *http.Request) {
			handleImportPreview(response, request, application)
		})
		api.Post("/imports/{importID}/commit", func(response http.ResponseWriter, request *http.Request) {
			handleImportCommit(response, request, application)
		})
		api.Get("/knowledge", func(response http.ResponseWriter, request *http.Request) {
			handleKnowledgeList(response, request, application)
		})
		api.Get("/knowledge/{knowledgeID}", func(response http.ResponseWriter, request *http.Request) {
			handleKnowledgeGet(response, request, application)
		})
		api.Post("/knowledge/{knowledgeID}/tag", func(response http.ResponseWriter, request *http.Request) {
			handleKnowledgeTag(response, request, application)
		})
		api.Post("/chat", func(response http.ResponseWriter, request *http.Request) {
			handleChatSend(response, request, application)
		})
		api.Get("/chat/messages", func(response http.ResponseWriter, request *http.Request) {
			handleChatMessages(response, request, application)
		})
		api.Get("/chat/conversations", func(response http.ResponseWriter, request *http.Request) {
			handleChatConversations(response, request, application)
		})
		api.Post("/chat/attachments", func(response http.ResponseWriter, request *http.Request) {
			handleChatAttachmentUpload(response, request, application)
		})
		api.Get("/chat/attachments/{attachmentID}", func(response http.ResponseWriter, request *http.Request) {
			handleChatAttachmentGet(response, request, application)
		})
		api.Post("/compare", func(response http.ResponseWriter, request *http.Request) {
			handleCompare(response, request, application)
		})
		api.Post("/dump", func(response http.ResponseWriter, request *http.Request) {
			handleDump(response, request, application)
		})
		api.Post("/integrate", func(response http.ResponseWriter, request *http.Request) {
			handleIntegrateCreate(response, request, application)
		})
		api.Get("/integrate", func(response http.ResponseWriter, request *http.Request) {
			handleIntegrateList(response, request, application)
		})
		api.Get("/integrate/{noteID}", func(response http.ResponseWriter, request *http.Request) {
			handleIntegrateGet(response, request, application)
		})
		api.Post("/backups", func(response http.ResponseWriter, request *http.Request) {
			handleBackupCreate(response, request, application)
		})
		api.Get("/backups", func(response http.ResponseWriter, request *http.Request) {
			handleBackupList(response, request, application)
		})
		if application != nil && application.Launcher != nil {
			api.Post("/launcher/close", func(response http.ResponseWriter, request *http.Request) {
				handleLauncherClose(response, request, application)
			})
			api.Post("/update/apply", func(response http.ResponseWriter, request *http.Request) {
				handleUpdateApply(response, request, application)
			})
		}
	})
	if application != nil && application.Launcher != nil {
		router.NotFound(func(response http.ResponseWriter, request *http.Request) {
			application.Launcher.SPAHandler().ServeHTTP(response, request)
		})
	}
	return router
}

func handleBackupCreate(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Store == nil || application.Backups == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "backup service unavailable"})
		return
	}
	var input struct {
		Category string `json:"category"`
	}
	if request.ContentLength != 0 {
		request.Body = http.MaxBytesReader(response, request.Body, maxImportJSONBytes)
		if err := decodeRequest(request, &input); err != nil {
			writeJSON(response, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
	}
	category := backup.Category(input.Category)
	if input.Category == "" {
		category = backup.Daily
	}
	if category != backup.Daily && category != backup.PreUpdate {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "category must be daily or pre-update"})
		return
	}
	result, err := application.Backups.Create(request.Context(), application.Config.DBPath, category)
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "create backup failed"})
		return
	}
	record, err := application.RecordBackup(request.Context(), result)
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "record backup failed"})
		return
	}
	writeJSON(response, http.StatusCreated, map[string]any{"id": record.ID, "category": record.Category, "result": result, "record": record})
}

func handleBackupList(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	if _, err := application.Store.ReconcileBackupRecords(request.Context()); err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "reconcile backups failed"})
		return
	}
	records, err := application.Store.ListBackupRecords(request.Context(), parseLimit(request.URL.Query().Get("limit"), 50, 100))
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "list backups failed"})
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{"items": records, "count": len(records)})
}

func importService(application *app.App) (*importer.Service, error) {
	if application == nil || application.Store == nil {
		return nil, errors.New("application unavailable")
	}
	return importer.NewService(application.Store, application.Config.DataDir), nil
}

func handleImportUpload(response http.ResponseWriter, request *http.Request, application *app.App) {
	service, err := importService(application)
	if err != nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": err.Error()})
		return
	}
	request.Body = http.MaxBytesReader(response, request.Body, importer.MaxImportBytes+(1<<20))
	if err := request.ParseMultipartForm(importer.MaxImportBytes + (1 << 20)); err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "invalid multipart upload"})
		return
	}
	file, header, err := request.FormFile("file")
	if err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "multipart file field is required"})
		return
	}
	defer file.Close()
	result, err := service.Upload(request.Context(), io.LimitReader(file, importer.MaxImportBytes+1), header.Filename, request.FormValue("table"))
	if err != nil {
		writeImportError(response, err)
		return
	}
	writeJSON(response, http.StatusCreated, result)
}

func handleImportGet(response http.ResponseWriter, request *http.Request, application *app.App) {
	service, err := importService(application)
	if err != nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": err.Error()})
		return
	}
	result, err := service.Get(request.Context(), chi.URLParam(request, "importID"))
	if err != nil {
		writeImportError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, result)
}

func handleImportPreview(response http.ResponseWriter, request *http.Request, application *app.App) {
	service, err := importService(application)
	if err != nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": err.Error()})
		return
	}
	var input struct {
		Mapping importer.Mapping `json:"mapping"`
	}
	request.Body = http.MaxBytesReader(response, request.Body, maxImportJSONBytes)
	if err := decodeRequest(request, &input); err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	result, err := service.Preview(request.Context(), chi.URLParam(request, "importID"), input.Mapping)
	if err != nil {
		writeImportError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, result)
}

func handleImportCommit(response http.ResponseWriter, request *http.Request, application *app.App) {
	service, err := importService(application)
	if err != nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": err.Error()})
		return
	}
	var input struct {
		Resolutions map[string]string `json:"resolutions"`
	}
	if request.ContentLength != 0 {
		request.Body = http.MaxBytesReader(response, request.Body, maxImportJSONBytes)
		if err := decodeRequest(request, &input); err != nil {
			writeJSON(response, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
	}
	for _, resolution := range input.Resolutions {
		if resolution != "merge" && resolution != "new_sense" && resolution != "reject" {
			writeJSON(response, http.StatusBadRequest, map[string]string{"error": "resolution must be merge, new_sense, or reject"})
			return
		}
	}
	result, err := service.Commit(request.Context(), chi.URLParam(request, "importID"), input.Resolutions)
	if err != nil {
		writeImportError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, result)
}

func handleKnowledgeList(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	limit := parseLimit(request.URL.Query().Get("limit"), 100, 500)
	offset := parseOffset(request.URL.Query().Get("offset"))
	var items []models.KnowledgeItem
	var err error
	if groupID := strings.TrimSpace(request.URL.Query().Get("group")); groupID != "" {
		items, err = application.Store.ListItemsByGroup(request.Context(), groupID, limit, offset)
	} else {
		items, err = application.Store.ListKnowledgeItems(request.Context(), models.KnowledgeListOptions{
			Query: request.URL.Query().Get("q"), Subject: request.URL.Query().Get("subject"),
			Tag: request.URL.Query().Get("tag"), Limit: limit, Offset: offset,
		})
	}
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{"items": items, "count": len(items)})
}

func handleKnowledgeGet(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	item, err := application.Store.GetKnowledgeItem(request.Context(), chi.URLParam(request, "knowledgeID"))
	if err != nil {
		writeStoreError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, item)
}

func writeImportError(response http.ResponseWriter, err error) {
	if errors.Is(err, db.ErrNotFound) {
		writeJSON(response, http.StatusNotFound, map[string]string{"error": err.Error()})
		return
	}
	message := strings.ToLower(err.Error())
	status := http.StatusInternalServerError
	if strings.Contains(message, "already committed") || strings.Contains(message, "must be previewed") {
		status = http.StatusConflict
	} else if isImportClientError(message) {
		status = http.StatusBadRequest
	}
	if status == http.StatusInternalServerError {
		writeJSON(response, status, map[string]string{"error": "import operation failed"})
		return
	}
	writeJSON(response, status, map[string]string{"error": err.Error()})
}

func isImportClientError(message string) bool {
	for _, marker := range []string{
		"unsupported import extension",
		"upload body is empty",
		"import exceeds",
		"import must be a regular file",
		"read csv ",
		"duplicate csv header",
		"csv ",
		"decode jsonl row",
		"jsonl ",
		"sqlite import",
		"sqlite table",
		"mapping",
		"source column",
		"term and definition are required",
		"item_type",
		"import preview has no rows",
	} {
		if strings.Contains(message, marker) {
			return true
		}
	}
	return false
}

type reviewPromptResponse struct {
	ID              string   `json:"id"`
	KnowledgeItemID string   `json:"knowledge_item_id"`
	PromptType      string   `json:"prompt_type"`
	Question        string   `json:"question"`
	Options         []string `json:"options,omitempty"`
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
	SelfRating  *int   `json:"self_rating"`
}

type answerResponse struct {
	AttemptID       string    `json:"attempt_id"`
	Outcome         string    `json:"outcome"`
	Rating          int       `json:"rating"`
	Feedback        string    `json:"feedback"`
	DueAt           time.Time `json:"due_at"`
	ExpectedAnswers []string  `json:"expected_answers"`
}

// evaluationFromSelfRating converts a learner's 1-3 self-report into the same
// Evaluation shape that EvaluateAnswer produces, so the scheduler and the
// attempt history stay on one code path.
func evaluationFromSelfRating(rating int) memory.Evaluation {
	switch rating {
	case 1:
		return memory.Evaluation{Outcome: memory.OutcomeIncorrect, Rating: memory.RatingAgain, Feedback: "需要重学"}
	case 2:
		return memory.Evaluation{Outcome: memory.OutcomePartial, Rating: memory.RatingHard, Feedback: "模糊记忆"}
	default:
		return memory.Evaluation{Outcome: memory.OutcomeCorrect, Rating: memory.RatingGood, Feedback: "认识"}
	}
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
			"prompt_count": 4,
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
		ItemType:          item.ItemType,
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
			PayloadJSON: json.RawMessage(`{"prompt_count":4}`),
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
	prompts, err := application.Store.DuePromptsWithOptions(request.Context(), time.Now().UTC(), db.DuePromptOptions{
		Limit:   limit,
		Subject: request.URL.Query().Get("subject"),
		Mode:    request.URL.Query().Get("mode"),
	})
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
				Options:         clozeOptions(request.Context(), application.Store, prompt, item),
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

var clozeFallbackPool = []string{
	"resilient", "fluent", "serendipity", "diligent", "ambiguous",
	"coherent", "subtle", "vivid", "reluctant", "sincere",
}

// clozeOptions builds four deterministic choices for cloze-style guessing:
// the correct term plus three distractors from the knowledge base, padded
// from a small fallback pool when the library is still nearly empty. Non-word
// items keep the free-text cloze and receive no options.
func clozeOptions(ctx context.Context, store *db.Store, prompt models.Prompt, item models.KnowledgeItem) []string {
	if prompt.PromptType != string(memory.PromptContextCloze) || !wordLikeItem(item.ItemType) {
		return nil
	}
	correct := item.Term
	seen := map[string]bool{strings.ToLower(strings.TrimSpace(correct)): true}
	options := []string{correct}
	distractors, err := store.ListDistractorTerms(ctx, item.ID, 3)
	if err != nil {
		distractors = nil
	}
	for _, term := range distractors {
		key := strings.ToLower(strings.TrimSpace(term))
		if key == "" || seen[key] {
			continue
		}
		seen[key] = true
		options = append(options, term)
		if len(options) == 4 {
			break
		}
	}
	for _, term := range clozeFallbackPool {
		if len(options) == 4 {
			break
		}
		key := strings.ToLower(strings.TrimSpace(term))
		if seen[key] {
			continue
		}
		seen[key] = true
		options = append(options, term)
	}
	if len(options) < 4 {
		return options
	}
	sort.SliceStable(options, func(i, j int) bool {
		left := sha256.Sum256([]byte(prompt.ID + "\x00" + options[i]))
		right := sha256.Sum256([]byte(prompt.ID + "\x00" + options[j]))
		return hex.EncodeToString(left[:]) < hex.EncodeToString(right[:])
	})
	return options
}

func wordLikeItem(itemType string) bool {
	switch strings.ToLower(strings.TrimSpace(itemType)) {
	case "word_sense", "phrase", "collocation":
		return true
	default:
		return false
	}
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
	if len(prompt.AcceptedAnswers) == 0 {
		evaluation = evaluateFreeText(request.Context(), application, prompt, input.Answer)
	}
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

func evaluateFreeText(ctx context.Context, application *app.App, prompt models.Prompt, answer string) memory.Evaluation {
	provider, err := providerFor(application)
	if err != nil {
		return memory.EvaluateFreeTextAnswer(answer)
	}
	response, err := provider.Generate(ctx, agent.Request{
		Kind: agent.KindEvaluateFreeText,
		FreeText: &agent.FreeTextInput{
			Question:        prompt.Question,
			Answer:          answer,
			PromptType:      prompt.PromptType,
			AcceptedAnswers: prompt.AcceptedAnswers,
		},
	})
	if err != nil || response.Feedback == nil {
		return memory.EvaluateFreeTextAnswer(answer)
	}
	return memory.Evaluation{
		Outcome:  memory.Outcome(response.Feedback.Outcome),
		Rating:   memory.Rating(response.Feedback.Rating),
		Feedback: response.Feedback.Message,
	}
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
	subjectsDue := map[string]int{}
	subjectRows, err := database.QueryContext(ctx, `
		SELECT COALESCE(k.subject, ''), COUNT(*)
		FROM prompts AS p
		JOIN review_states AS rs ON rs.prompt_id = p.id
		JOIN knowledge_items AS k ON k.id = p.knowledge_item_id
		WHERE rs.due_at <= ?
		GROUP BY k.subject`, formatHTTPTime(time.Now().UTC()))
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	for subjectRows.Next() {
		var subject string
		var count int
		if err := subjectRows.Scan(&subject, &count); err != nil {
			_ = subjectRows.Close()
			writeJSON(response, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		subjectsDue[subject] = count
	}
	_ = subjectRows.Close()
	recentItems, err := application.Store.ListKnowledgeItems(ctx, models.KnowledgeListOptions{Limit: 5, Offset: 0})
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{
		"knowledge_count": knowledgeCount,
		"prompt_count":    promptCount,
		"attempt_count":   attemptCount,
		"due_count":       dueCount,
		"reviewed_today":  reviewedToday,
		"current_streak":  currentStreak,
		"provider":        application.Config.ActiveProvider,
		"offline":         application.Config.ActiveProvider == "mock",
		"subjects_due":    subjectsDue,
		"recent_items":    recentItems,
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
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("decode JSON request: request must contain one JSON value")
		}
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

func parseOffset(value string) int {
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed < 0 {
		return 0
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

func trustedOriginOnly(next http.Handler) http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		origin := strings.TrimSpace(request.Header.Get("Origin"))
		if origin == "" || isTrustedOrigin(origin) {
			next.ServeHTTP(response, request)
			return
		}
		http.Error(response, http.StatusText(http.StatusForbidden), http.StatusForbidden)
	})
}

func isTrustedOrigin(origin string) bool {
	if origin == "http://wails.localhost" || origin == "wails://wails" {
		return true
	}
	parsed, err := url.Parse(origin)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" || parsed.User != nil {
		return false
	}
	if parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" {
		return false
	}
	return isLoopbackHost(parsed.Host)
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
