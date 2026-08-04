package httpapi

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"study-os/backend/agent"
	"study-os/backend/app"
	"study-os/backend/models"
)

func handleIntegrateCreate(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	var input struct {
		Subject     string `json:"subject"`
		Title       string `json:"title"`
		Text        string `json:"text"`
		KnowledgeID string `json:"knowledge_id"`
		MaxCards    int    `json:"max_cards"`
	}
	request.Body = http.MaxBytesReader(response, request.Body, 256<<10)
	if err := decodeRequest(request, &input); err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	subject := strings.ToLower(strings.TrimSpace(input.Subject))
	sourceType := ""
	sourceID := strings.TrimSpace(input.KnowledgeID)
	text := strings.TrimSpace(input.Text)
	title := strings.TrimSpace(input.Title)
	if sourceID != "" {
		item, err := application.Store.GetKnowledgeItem(request.Context(), sourceID)
		if err != nil {
			writeStoreError(response, err)
			return
		}
		sourceType = "knowledge_item"
		if subject == "" {
			subject = item.Subject
		}
		if title == "" {
			title = item.Term
		}
		parts := []string{item.Term, item.ConciseDefinition, item.DetailedMarkdown, item.Example}
		text = strings.TrimSpace(strings.Join(parts, "\n"))
	}
	if text == "" {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "text 或 knowledge_id 至少提供一个"})
		return
	}
	if title == "" {
		title = subject + " 整合笔记"
	}
	provider, err := providerFor(application)
	if err != nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "AI 服务商未配置"})
		return
	}
	generated, err := provider.Generate(request.Context(), agent.Request{
		Kind: agent.KindIntegrate,
		Integrate: &agent.IntegrateInput{
			Subject:  subject,
			Title:    title,
			Text:     text,
			MaxCards: input.MaxCards,
		},
	})
	if err != nil || generated.Integrate == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "整合生成失败"})
		return
	}
	mindmapJSON, _ := json.Marshal(generated.Integrate.Map)
	cardsJSON, _ := json.Marshal(generated.Integrate.Cards)
	note := models.IntegratedNote{
		ID:          newRequestID("note"),
		Subject:     subject,
		Title:       title,
		SourceType:  sourceType,
		SourceID:    sourceID,
		MindmapJSON: mindmapJSON,
		CardsJSON:   cardsJSON,
		CreatedAt:   time.Now().UTC(),
	}
	if err := application.Store.CreateIntegratedNote(request.Context(), note); err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "保存整合笔记失败"})
		return
	}
	writeJSON(response, http.StatusCreated, note)
}

func handleIntegrateList(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	notes, err := application.Store.ListIntegratedNotes(request.Context(),
		strings.ToLower(strings.TrimSpace(request.URL.Query().Get("subject"))),
		parseLimit(request.URL.Query().Get("limit"), 50, 100))
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "读取整合笔记失败"})
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{"items": notes, "count": len(notes)})
}

func handleIntegrateGet(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	note, err := application.Store.GetIntegratedNote(request.Context(), chi.URLParam(request, "noteID"))
	if err != nil {
		writeStoreError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, note)
}
