package httpapi

import (
	"errors"
	"net/http"
	"net/url"
	"strings"

	"study-os/backend/app"
	"study-os/backend/db"
	"study-os/backend/models"
)

type qaRecordWriteInput struct {
	Subject               string `json:"subject"`
	ContextType           string `json:"context_type"`
	ContextID             string `json:"context_id"`
	OriginalUnderstanding string `json:"original_understanding"`
	CorrectedModel        string `json:"corrected_model"`
	MasteryEvidence       string `json:"mastery_evidence"`
	Unresolved            string `json:"unresolved"`
	Status                string `json:"status"`
}

func handleQARecordMissingSession(response http.ResponseWriter, _ *http.Request) {
	writeJSON(response, http.StatusBadRequest, map[string]string{"error": "session id is required"})
}

func handleQARecordGet(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	sessionID, err := qaRecordSessionID(request)
	if err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	record, err := application.Store.GetQARecord(request.Context(), sessionID)
	if err != nil {
		writeQARecordError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, record)
}

func handleQARecordPut(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	var input qaRecordWriteInput
	request.Body = http.MaxBytesReader(response, request.Body, maxImportJSONBytes)
	if err := decodeRequest(request, &input); err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	sessionID, err := qaRecordSessionID(request)
	if err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	status := strings.TrimSpace(input.Status)
	if status == "" {
		status = models.QARecordStatusOpen
	}
	var id string
	if existing, err := application.Store.GetQARecord(request.Context(), sessionID); err == nil {
		id = existing.ID
	} else if errors.Is(err, db.ErrNotFound) {
		id = newRequestID("qa")
	} else {
		writeQARecordError(response, err)
		return
	}
	record, err := application.Store.UpsertQARecord(request.Context(), models.QARecord{
		ID:                    id,
		SessionID:             sessionID,
		Subject:               input.Subject,
		ContextType:           input.ContextType,
		ContextID:             input.ContextID,
		OriginalUnderstanding: input.OriginalUnderstanding,
		CorrectedModel:        input.CorrectedModel,
		MasteryEvidence:       input.MasteryEvidence,
		Unresolved:            input.Unresolved,
		Status:                status,
	})
	if err != nil {
		writeQARecordError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, record)
}

func qaRecordSessionID(request *http.Request) (string, error) {
	const routePrefix = "/api/chat/records/"
	escapedPath := request.URL.EscapedPath()
	if !strings.HasPrefix(escapedPath, routePrefix) {
		return "", errors.New("session id is invalid")
	}
	raw := strings.TrimPrefix(escapedPath, routePrefix)
	decoded, err := url.PathUnescape(raw)
	if err != nil {
		return "", errors.New("session id is invalid")
	}
	decoded = strings.TrimSpace(decoded)
	if decoded == "" {
		return "", errors.New("session id is required")
	}
	return decoded, nil
}

func writeQARecordError(response http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, db.ErrInvalidQARecord):
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": err.Error()})
	case errors.Is(err, db.ErrNotFound):
		writeJSON(response, http.StatusNotFound, map[string]string{"error": err.Error()})
	default:
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "qa record operation failed"})
	}
}
