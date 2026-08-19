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

func handleLessonList(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	status := strings.TrimSpace(request.URL.Query().Get("status"))
	if status != "" && !models.IsLessonStatusValid(status) {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "invalid lesson status"})
		return
	}
	items, err := application.Store.ListLessons(request.Context(), models.LessonListOptions{
		Subject: strings.TrimSpace(request.URL.Query().Get("subject")),
		Status:  status,
		Limit:   parseLimit(request.URL.Query().Get("limit"), 50, 100),
		Offset:  parseOffset(request.URL.Query().Get("offset")),
	})
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "list lessons failed"})
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{"items": items, "count": len(items)})
}

func handleLessonCreate(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	var input struct {
		ID         string                 `json:"id"`
		Subject    string                 `json:"subject"`
		Title      string                 `json:"title"`
		SourceType string                 `json:"source_type"`
		SourceID   string                 `json:"source_id"`
		Status     string                 `json:"status"`
		Document   *models.LessonDocument `json:"document"`
	}
	request.Body = http.MaxBytesReader(response, request.Body, 512<<10)
	if err := decodeRequest(request, &input); err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	id := strings.TrimSpace(input.ID)
	if id == "" {
		id = newRequestID("lesson")
	}
	document := models.NewLessonDocument()
	if input.Document != nil {
		document = *input.Document
	}
	status := strings.TrimSpace(input.Status)
	if status == "" {
		status = models.LessonStatusDraft
	}
	lesson := models.Lesson{
		ID: id, Subject: strings.TrimSpace(input.Subject), Title: strings.TrimSpace(input.Title),
		SourceType: strings.TrimSpace(input.SourceType), SourceID: strings.TrimSpace(input.SourceID),
		Status: status, Document: document,
	}
	if err := application.Store.CreateLesson(request.Context(), lesson); err != nil {
		writeLessonError(response, err)
		return
	}
	created, err := application.Store.GetLesson(request.Context(), id)
	if err != nil {
		writeLessonError(response, err)
		return
	}
	writeJSON(response, http.StatusCreated, created)
}

func handleLessonGet(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	id := chi.URLParam(request, "lessonID")
	versionText := strings.TrimSpace(request.URL.Query().Get("version"))
	if versionText == "" {
		lesson, err := application.Store.GetLesson(request.Context(), id)
		if err != nil {
			writeLessonError(response, err)
			return
		}
		writeJSON(response, http.StatusOK, lesson)
		return
	}
	version := parsePositiveInt(versionText)
	if version <= 0 {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "version must be a positive integer"})
		return
	}
	lesson, err := application.Store.GetLesson(request.Context(), id)
	if err != nil {
		writeLessonError(response, err)
		return
	}
	revision, err := application.Store.GetLessonVersion(request.Context(), id, version)
	if err != nil {
		writeLessonError(response, err)
		return
	}
	lesson.CurrentVersion = revision.Version
	lesson.Document = revision.Document
	writeJSON(response, http.StatusOK, lesson)
}

func handleLessonUpdate(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	var input struct {
		Subject    *string                `json:"subject"`
		Title      *string                `json:"title"`
		SourceType *string                `json:"source_type"`
		SourceID   *string                `json:"source_id"`
		Status     *string                `json:"status"`
		Version    *int                   `json:"version"`
		Document   *models.LessonDocument `json:"document"`
	}
	request.Body = http.MaxBytesReader(response, request.Body, 512<<10)
	if err := decodeRequest(request, &input); err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if input.Version == nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "version is required"})
		return
	}
	current, err := application.Store.GetLesson(request.Context(), chi.URLParam(request, "lessonID"))
	if err != nil {
		writeLessonError(response, err)
		return
	}
	if input.Subject != nil {
		current.Subject = strings.TrimSpace(*input.Subject)
	}
	if input.Title != nil {
		current.Title = strings.TrimSpace(*input.Title)
	}
	if input.SourceType != nil {
		current.SourceType = strings.TrimSpace(*input.SourceType)
	}
	if input.SourceID != nil {
		current.SourceID = strings.TrimSpace(*input.SourceID)
	}
	if input.Status != nil {
		current.Status = strings.TrimSpace(*input.Status)
	}
	if input.Document != nil {
		current.Document = *input.Document
	}
	expectedVersion := *input.Version
	if expectedVersion <= 0 {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "version must be positive"})
		return
	}
	updated, err := application.Store.UpdateLesson(request.Context(), current, expectedVersion)
	if err != nil {
		writeLessonError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, updated)
}

func parsePositiveInt(value string) int {
	parsed := parseOffset(value)
	if parsed < 1 || strings.TrimSpace(value) == "" {
		return 0
	}
	return parsed
}

func writeLessonError(response http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, db.ErrLessonAlreadyExists):
		writeJSON(response, http.StatusConflict, map[string]string{"error": err.Error()})
	case errors.Is(err, db.ErrLessonVersionConflict):
		writeJSON(response, http.StatusConflict, map[string]string{"error": err.Error()})
	case errors.Is(err, db.ErrNotFound):
		writeJSON(response, http.StatusNotFound, map[string]string{"error": err.Error()})
	case errors.Is(err, db.ErrInvalidLesson):
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": err.Error()})
	default:
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "lesson operation failed"})
	}
}
