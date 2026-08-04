package httpapi

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"study-os/backend/agent"
	"study-os/backend/app"
	"study-os/backend/models"
)

func handleChatSend(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	var input struct {
		Subject string `json:"subject"`
		Message string `json:"message"`
	}
	request.Body = http.MaxBytesReader(response, request.Body, maxImportJSONBytes)
	if err := decodeRequest(request, &input); err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	message := strings.TrimSpace(input.Message)
	if message == "" {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "message is required"})
		return
	}
	subject := strings.ToLower(strings.TrimSpace(input.Subject))
	if subject == "" {
		subject = "all"
	}
	now := time.Now().UTC()
	userMessage := models.ChatMessage{
		ID: newRequestID("chat-user"), SessionID: "default", Subject: subject,
		Role: "user", Content: message, Status: "done", CreatedAt: now,
	}
	assistantID := newRequestID("chat-ai")
	assistantMessage := models.ChatMessage{
		ID: assistantID, SessionID: "default", Subject: subject,
		Role: "assistant", Status: "pending", CreatedAt: now,
	}
	if err := application.Store.CreateChatMessage(request.Context(), userMessage); err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "保存问题失败"})
		return
	}
	if err := application.Store.CreateChatMessage(request.Context(), assistantMessage); err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "创建回复占位失败"})
		return
	}
	// 异步处理：接口立即返回，AI 回答完成后静默写入记录。
	go processChatAnswer(application, subject, message, assistantID)
	writeJSON(response, http.StatusAccepted, map[string]any{
		"message_id": assistantID,
		"status":     "pending",
	})
}

func processChatAnswer(application *app.App, subject, message, assistantID string) {
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()
	answer := ""
	status := "done"
	errorSummary := ""
	provider, err := providerFor(application)
	if err != nil {
		status = "failed"
		errorSummary = "AI 服务商未配置"
	} else {
		history, listErr := application.Store.ListChatMessages(ctx, subject, 20)
		if listErr != nil {
			history = nil
		}
		turns := make([]agent.ChatTurn, 0, len(history))
		for _, item := range history {
			if item.ID == assistantID || item.Status != "done" || strings.TrimSpace(item.Content) == "" {
				continue
			}
			turns = append(turns, agent.ChatTurn{Role: item.Role, Content: item.Content})
		}
		generated, genErr := provider.Generate(ctx, agent.Request{
			Kind: agent.KindChat,
			Chat: &agent.ChatInput{Subject: subject, Prompt: message, History: turns},
		})
		if genErr == nil && generated.Chat != nil {
			answer = generated.Chat.Answer
		} else {
			status = "failed"
			errorSummary = "AI 回答失败，请稍后重试"
		}
	}
	if status == "done" && strings.TrimSpace(answer) == "" {
		status = "failed"
		errorSummary = "AI 未返回内容"
	}
	_ = application.Store.UpdateChatMessage(ctx, assistantID, answer, status, errorSummary)
}

func handleChatMessages(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	messages, err := application.Store.ListChatMessages(request.Context(),
		strings.ToLower(strings.TrimSpace(request.URL.Query().Get("subject"))),
		parseLimit(request.URL.Query().Get("limit"), 50, 200))
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "读取对话记录失败"})
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{"items": messages, "count": len(messages)})
}

func handleCompare(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	var input struct {
		Subject string `json:"subject"`
		TermA   string `json:"term_a"`
		TermB   string `json:"term_b"`
	}
	request.Body = http.MaxBytesReader(response, request.Body, maxImportJSONBytes)
	if err := decodeRequest(request, &input); err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if strings.TrimSpace(input.TermA) == "" || strings.TrimSpace(input.TermB) == "" {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "term_a 和 term_b 都是必填的"})
		return
	}
	provider, err := providerFor(application)
	if err != nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "AI 服务商未配置"})
		return
	}
	generated, err := provider.Generate(request.Context(), agent.Request{
		Kind: agent.KindCompare,
		Compare: &agent.CompareInput{
			Subject: strings.ToLower(strings.TrimSpace(input.Subject)),
			TermA:   strings.TrimSpace(input.TermA),
			TermB:   strings.TrimSpace(input.TermB),
		},
	})
	if err != nil || generated.Compare == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "对比生成失败"})
		return
	}
	writeJSON(response, http.StatusOK, generated.Compare)
}

func handleDump(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	var input struct {
		Text string `json:"text"`
	}
	request.Body = http.MaxBytesReader(response, request.Body, maxImportJSONBytes)
	if err := decodeRequest(request, &input); err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	text := strings.TrimSpace(input.Text)
	if text == "" {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "text is required"})
		return
	}
	now := time.Now().UTC()
	item := models.KnowledgeItem{
		ID:                newRequestID("dump"),
		ItemType:          "brain_dump",
		Term:              dumpTerm(text),
		ConciseDefinition: text,
		Tags:              []string{"brain_dump"},
		CreatedAt:         now,
		UpdatedAt:         now,
	}
	if err := application.Store.CreateKnowledgeItem(request.Context(), item); err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "保存念头失败"})
		return
	}
	writeJSON(response, http.StatusCreated, map[string]any{"id": item.ID, "term": item.Term})
}

func dumpTerm(text string) string {
	runes := []rune(text)
	if len(runes) > 40 {
		runes = runes[:40]
	}
	term := strings.TrimSpace(string(runes))
	if term == "" {
		return "未整理念头"
	}
	return term
}

func handleKnowledgeTag(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	var input struct {
		Tag    string `json:"tag"`
		Remove bool   `json:"remove"`
	}
	request.Body = http.MaxBytesReader(response, request.Body, maxImportJSONBytes)
	if err := decodeRequest(request, &input); err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	tag := strings.ToLower(strings.TrimSpace(input.Tag))
	if tag == "" {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "tag is required"})
		return
	}
	knowledgeID := chi.URLParam(request, "knowledgeID")
	item, err := application.Store.GetKnowledgeItem(request.Context(), knowledgeID)
	if err != nil {
		writeStoreError(response, err)
		return
	}
	tags := item.Tags
	found := false
	for _, existing := range tags {
		if existing == tag {
			found = true
			break
		}
	}
	if input.Remove {
		if found {
			kept := tags[:0]
			for _, existing := range tags {
				if existing != tag {
					kept = append(kept, existing)
				}
			}
			item.Tags = kept
		}
	} else if !found {
		item.Tags = append(item.Tags, tag)
	}
	item.UpdatedAt = time.Now().UTC()
	if err := application.Store.UpdateKnowledgeItem(request.Context(), item); err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "更新标签失败"})
		return
	}
	writeJSON(response, http.StatusOK, item)
}
