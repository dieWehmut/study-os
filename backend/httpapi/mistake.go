package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"study-os/backend/app"
	"study-os/backend/db"
	"study-os/backend/models"
)

func handleMistakeCreate(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	var input struct {
		Subject   string          `json:"subject"`
		Stem      string          `json:"stem"`
		Cause     string          `json:"cause"`
		Note      string          `json:"note"`
		Answer    string          `json:"answer"`
		ElapsedMS int             `json:"elapsed_ms"`
		Evidence  json.RawMessage `json:"evidence"`
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
		Subject:      strings.ToLower(strings.TrimSpace(input.Subject)),
		Stem:         input.Stem,
		Cause:        input.Cause,
		Note:         input.Note,
		Answer:       input.Answer,
		ElapsedMS:    input.ElapsedMS,
		EvidenceJSON: input.Evidence,
	})
	if err != nil {
		if errors.Is(err, db.ErrInvalidMistakeEvidence) {
			writeJSON(response, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "记录错题失败"})
		return
	}
	writeJSON(response, http.StatusCreated, filed)
}

func handleMistakeEvidenceUpdate(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	var input struct {
		Evidence json.RawMessage `json:"evidence"`
	}
	request.Body = http.MaxBytesReader(response, request.Body, 64<<10)
	if err := decodeRequest(request, &input); err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	updated, err := application.Store.UpdateMistakeEvidence(
		request.Context(), chi.URLParam(request, "attemptID"), input.Evidence,
	)
	if err != nil {
		if errors.Is(err, db.ErrInvalidMistakeEvidence) {
			writeJSON(response, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		writeStoreError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, updated)
}

func handleMistakeDelete(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	if err := application.Store.DeleteMistake(request.Context(), chi.URLParam(request, "attemptID")); err != nil {
		writeStoreError(response, err)
		return
	}
	response.WriteHeader(http.StatusNoContent)
}

// handleMistakeCorrect marks a filed mistake as one you have since got right.
//
// Distinct from DELETE on purpose: 取消 is for a row filed by accident, 订正 is
// for a mistake you have fixed. Deleting on 订正 would erase the evidence you
// ever got it wrong, which is the one thing the log exists to keep.
func handleMistakeCorrect(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	var input struct {
		Answer    string `json:"answer"`
		ElapsedMS int    `json:"elapsed_ms"`
	}
	request.Body = http.MaxBytesReader(response, request.Body, 16<<10)
	if err := decodeRequest(request, &input); err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if strings.TrimSpace(input.Answer) == "" {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "correction answer is required"})
		return
	}
	if input.ElapsedMS < 0 {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "correction elapsed_ms cannot be negative"})
		return
	}
	corrected, err := application.Store.RecordMistakeCorrection(request.Context(), chi.URLParam(request, "attemptID"), models.MistakeCorrectionInput{
		Answer: input.Answer, ElapsedMS: input.ElapsedMS,
	})
	if err != nil {
		writeStoreError(response, err)
		return
	}
	// 200, not 201: pressing it twice is the same answer, not a second retry.
	writeJSON(response, http.StatusOK, corrected)
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
