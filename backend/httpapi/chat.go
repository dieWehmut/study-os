package httpapi

import (
	"context"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"study-os/backend/agent"
	"study-os/backend/app"
	"study-os/backend/models"
)

const maxChatAttachmentBytes = 5 << 20

func handleChatSend(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	var input struct {
		Subject       string   `json:"subject"`
		Message       string   `json:"message"`
		SessionID     string   `json:"session_id"`
		AttachmentIDs []string `json:"attachment_ids"`
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
	sessionID := strings.TrimSpace(input.SessionID)
	if sessionID == "" {
		sessionID = newRequestID("sess")
	}
	content := message
	for _, attachmentID := range input.AttachmentIDs {
		attachment, err := application.Store.GetChatAttachment(request.Context(), attachmentID)
		if err != nil {
			writeJSON(response, http.StatusBadRequest, map[string]string{"error": "附件不存在或已被删除"})
			return
		}
		if attachment.Kind == "text" {
			extracted, readErr := readAttachmentText(attachment.StoredPath, 100<<10)
			if readErr == nil && strings.TrimSpace(extracted) != "" {
				content += "\n\n[附件：" + attachment.Name + " 的内容]\n" + strings.TrimSpace(extracted)
			} else {
				content += "\n[附件：" + attachment.Name + "]（内容读取失败，已保存原文件）"
			}
		} else {
			content += "\n[附件：" + attachment.Name + "]（已保存原文件，当前模型暂不支持读取该格式）"
		}
	}
	now := time.Now().UTC()
	userMessage := models.ChatMessage{
		ID: newRequestID("chat-user"), SessionID: sessionID, Subject: subject,
		Role: "user", Content: content, Status: "done", CreatedAt: now,
	}
	assistantID := newRequestID("chat-ai")
	assistantMessage := models.ChatMessage{
		ID: assistantID, SessionID: sessionID, Subject: subject,
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
	for _, attachmentID := range input.AttachmentIDs {
		_ = application.Store.UpdateChatAttachment(request.Context(), attachmentID, sessionID, subject, userMessage.ID)
	}
	go processChatAnswer(application, subject, sessionID, message, assistantID)
	writeJSON(response, http.StatusAccepted, map[string]any{
		"session_id": sessionID,
		"message_id": assistantID,
		"status":     "pending",
	})
}

func processChatAnswer(application *app.App, subject, sessionID, message, assistantID string) {
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
		history, listErr := application.Store.ListChatMessages(ctx, subject, sessionID, 20)
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
		strings.TrimSpace(request.URL.Query().Get("session_id")),
		parseLimit(request.URL.Query().Get("limit"), 50, 200))
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "读取对话记录失败"})
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{"items": messages, "count": len(messages)})
}

func handleChatConversations(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	subject := strings.ToLower(strings.TrimSpace(request.URL.Query().Get("subject")))
	if subject == "" {
		subject = "all"
	}
	conversations, err := application.Store.ListChatConversations(request.Context(), subject,
		parseLimit(request.URL.Query().Get("limit"), 50, 200))
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "读取对话列表失败"})
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{"items": conversations, "count": len(conversations)})
}

func handleChatAttachmentUpload(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	request.Body = http.MaxBytesReader(response, request.Body, maxChatAttachmentBytes+(1<<20))
	if err := request.ParseMultipartForm(maxChatAttachmentBytes + (1 << 20)); err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "无效的文件上传"})
		return
	}
	file, header, err := request.FormFile("file")
	if err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "multipart file field is required"})
		return
	}
	defer file.Close()
	if header.Size > maxChatAttachmentBytes {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "附件不能超过 5MB"})
		return
	}
	id := newRequestID("attach")
	kind := attachmentKind(header.Filename)
	directory := filepath.Join(application.Config.DataDir, "uploads", "chat")
	if err := os.MkdirAll(directory, 0o700); err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "创建附件目录失败"})
		return
	}
	destination := filepath.Join(directory, id+filepath.Ext(header.Filename))
	out, err := os.Create(destination)
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "保存附件失败"})
		return
	}
	written, copyErr := io.Copy(out, io.LimitReader(file, maxChatAttachmentBytes+1))
	_ = out.Close()
	if copyErr != nil || written > maxChatAttachmentBytes {
		_ = os.Remove(destination)
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "附件不能超过 5MB"})
		return
	}
	attachment := models.ChatAttachment{
		ID: id, Name: filepath.Base(header.Filename), StoredPath: destination,
		SizeBytes: written, Kind: kind, CreatedAt: time.Now().UTC(),
	}
	if err := application.Store.CreateChatAttachment(request.Context(), attachment); err != nil {
		_ = os.Remove(destination)
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "记录附件失败"})
		return
	}
	writeJSON(response, http.StatusCreated, map[string]any{
		"id": attachment.ID, "name": attachment.Name, "size_bytes": attachment.SizeBytes, "kind": attachment.Kind,
	})
}

func handleChatAttachmentGet(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	attachment, err := application.Store.GetChatAttachment(request.Context(), chi.URLParam(request, "attachmentID"))
	if err != nil {
		writeStoreError(response, err)
		return
	}
	response.Header().Set("Content-Disposition", "inline; filename*=UTF-8''"+strings.ReplaceAll(attachment.Name, `"`, ""))
	http.ServeFile(response, request, attachment.StoredPath)
}

func attachmentKind(name string) string {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".txt", ".md", ".csv", ".json", ".jsonl", ".log":
		return "text"
	case ".png", ".jpg", ".jpeg", ".gif", ".webp":
		return "image"
	case ".pdf":
		return "pdf"
	default:
		return "other"
	}
}

func readAttachmentText(path string, limit int64) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	content, err := io.ReadAll(io.LimitReader(file, limit))
	if err != nil {
		return "", err
	}
	return string(content), nil
}
