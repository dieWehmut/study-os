package httpapi

import (
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"study-os/backend/agent"
	"study-os/backend/app"
	"study-os/backend/models"
)

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
	item, err := application.Store.GetKnowledgeItem(request.Context(), chi.URLParam(request, "knowledgeID"))
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
