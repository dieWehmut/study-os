package httpapi

import (
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"study-os/backend/app"
	"study-os/backend/db"
	"study-os/backend/models"
)

func handleErrorCauseList(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	status := strings.ToLower(strings.TrimSpace(request.URL.Query().Get("status")))
	if status == "" {
		status = models.ErrorCauseStatusConfirmed
	}
	if status != models.ErrorCauseStatusAll && !models.IsErrorCauseStatusValid(status) {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "invalid error cause status"})
		return
	}
	causes, err := application.Store.ListErrorCauses(request.Context(), models.ErrorCauseListOptions{
		Subject: strings.ToLower(strings.TrimSpace(request.URL.Query().Get("subject"))),
		Status:  status,
		Limit:   parseLimit(request.URL.Query().Get("limit"), 200, 500),
		Offset:  parseOffset(request.URL.Query().Get("offset")),
	})
	if err != nil {
		writeErrorCauseError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{"items": causes, "count": len(causes)})
}

func handleErrorCauseCreate(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	var input errorCauseWriteInput
	request.Body = http.MaxBytesReader(response, request.Body, 64<<10)
	if err := decodeRequest(request, &input); err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	cause := input.toModel("")
	if err := application.Store.CreateErrorCause(request.Context(), cause); err != nil {
		writeErrorCauseError(response, err)
		return
	}
	created, err := application.Store.GetErrorCause(request.Context(), cause.ID)
	if err != nil {
		writeErrorCauseError(response, err)
		return
	}
	writeJSON(response, http.StatusCreated, created)
}

func handleErrorCauseUpdate(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	id := chi.URLParam(request, "causeID")
	current, err := application.Store.GetErrorCause(request.Context(), id)
	if err != nil {
		writeErrorCauseError(response, err)
		return
	}
	var input errorCauseWriteInput
	request.Body = http.MaxBytesReader(response, request.Body, 64<<10)
	if err := decodeRequest(request, &input); err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	updated := input.apply(current)
	if input.Subject != nil && strings.ToLower(strings.TrimSpace(*input.Subject)) != current.Subject {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "error cause subject is immutable"})
		return
	}
	result, err := application.Store.UpdateErrorCause(request.Context(), updated)
	if err != nil {
		writeErrorCauseError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, result)
}

func handleMistakeCauseUpdate(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	var input struct {
		Cause string `json:"cause"`
	}
	request.Body = http.MaxBytesReader(response, request.Body, 16<<10)
	if err := decodeRequest(request, &input); err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if strings.TrimSpace(input.Cause) == "" {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "cause is required"})
		return
	}
	mistake, err := application.Store.ReclassifyMistake(request.Context(), chi.URLParam(request, "attemptID"), input.Cause)
	if err != nil {
		writeErrorCauseError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, mistake)
}

type errorCauseWriteInput struct {
	ID          string  `json:"id"`
	Subject     *string `json:"subject"`
	ParentID    *string `json:"parent_id"`
	Label       *string `json:"label"`
	ReviewFixes *bool   `json:"review_fixes"`
	Action      *string `json:"action"`
	Status      *string `json:"status"`
	SourceType  *string `json:"source_type"`
	SourceID    *string `json:"source_id"`
	SortOrder   *int    `json:"sort_order"`
}

func (input errorCauseWriteInput) toModel(id string) models.ErrorCause {
	if id == "" {
		id = input.ID
	}
	cause := models.ErrorCause{ID: id}
	if input.Subject != nil {
		cause.Subject = *input.Subject
	}
	if input.ParentID != nil {
		cause.ParentID = *input.ParentID
	}
	if input.Label != nil {
		cause.Label = *input.Label
	}
	if input.ReviewFixes != nil {
		cause.ReviewFixes = *input.ReviewFixes
	}
	if input.Action != nil {
		cause.Action = *input.Action
	}
	if input.Status != nil {
		cause.Status = *input.Status
	}
	if input.SourceType != nil {
		cause.SourceType = *input.SourceType
	}
	if input.SourceID != nil {
		cause.SourceID = *input.SourceID
	}
	if input.SortOrder != nil {
		cause.SortOrder = *input.SortOrder
	}
	return cause
}

func (input errorCauseWriteInput) apply(current models.ErrorCause) models.ErrorCause {
	updated := current
	if input.Subject != nil {
		updated.Subject = *input.Subject
	}
	if input.ParentID != nil {
		updated.ParentID = *input.ParentID
	}
	if input.Label != nil {
		updated.Label = *input.Label
	}
	if input.ReviewFixes != nil {
		updated.ReviewFixes = *input.ReviewFixes
	}
	if input.Action != nil {
		updated.Action = *input.Action
	}
	if input.Status != nil {
		updated.Status = *input.Status
	}
	if input.SourceType != nil {
		updated.SourceType = *input.SourceType
	}
	if input.SourceID != nil {
		updated.SourceID = *input.SourceID
	}
	if input.SortOrder != nil {
		updated.SortOrder = *input.SortOrder
	}
	return updated
}

func writeErrorCauseError(response http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, db.ErrErrorCauseAlreadyExists):
		writeJSON(response, http.StatusConflict, map[string]string{"error": err.Error()})
	case errors.Is(err, db.ErrInvalidErrorCause):
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": err.Error()})
	case errors.Is(err, db.ErrNotFound):
		writeJSON(response, http.StatusNotFound, map[string]string{"error": err.Error()})
	default:
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "error cause operation failed"})
	}
}
