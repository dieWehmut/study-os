package httpapi

import (
	"net/http"
	"strings"

	"study-os/backend/app"
	"study-os/backend/models"
)

func handleMistakeCreate(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	var input struct {
		Subject string `json:"subject"`
		Stem    string `json:"stem"`
		Cause   string `json:"cause"`
		Note    string `json:"note"`
	}
	request.Body = http.MaxBytesReader(response, request.Body, 64<<10)
	if err := decodeRequest(request, &input); err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if strings.TrimSpace(input.Stem) == "" {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "题干不能为空"})
		return
	}
	filed, err := application.Store.RecordMistake(request.Context(), models.MistakeInput{
		Subject: strings.ToLower(strings.TrimSpace(input.Subject)),
		Stem:    input.Stem,
		Cause:   input.Cause,
		Note:    input.Note,
	})
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "记录错题失败"})
		return
	}
	writeJSON(response, http.StatusCreated, filed)
}

func handleMistakeList(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	mistakes, err := application.Store.ListMistakes(request.Context(), models.MistakeListOptions{
		Subject: strings.ToLower(strings.TrimSpace(request.URL.Query().Get("subject"))),
		Limit:   parseLimit(request.URL.Query().Get("limit"), 50, 200),
	})
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "读取错题失败"})
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{"items": mistakes, "count": len(mistakes)})
}
