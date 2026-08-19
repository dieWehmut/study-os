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

func handleLessonLinkList(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	targetType := strings.TrimSpace(request.URL.Query().Get("target_type"))
	if targetType != "" && !models.IsLessonLinkTargetValid(targetType) {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "invalid lesson link target type"})
		return
	}
	links, err := application.Store.ListLessonLinks(request.Context(), chi.URLParam(request, "lessonID"), models.LessonLinkListOptions{
		TargetType: targetType,
		Limit:      parseLimit(request.URL.Query().Get("limit"), 50, 100),
		Offset:     parseOffset(request.URL.Query().Get("offset")),
	})
	if err != nil {
		writeLessonLinkError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{"items": links, "count": len(links)})
}

func handleLessonLinkCreate(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	var input struct {
		TargetType string `json:"target_type"`
		TargetID   string `json:"target_id"`
	}
	request.Body = http.MaxBytesReader(response, request.Body, 32<<10)
	if err := decodeRequest(request, &input); err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	link := models.LessonLink{
		LessonID:   chi.URLParam(request, "lessonID"),
		TargetType: input.TargetType,
		TargetID:   input.TargetID,
	}
	if err := application.Store.CreateLessonLink(request.Context(), link); err != nil {
		writeLessonLinkError(response, err)
		return
	}
	created, err := application.Store.ListLessonLinks(request.Context(), link.LessonID, models.LessonLinkListOptions{
		TargetType: strings.TrimSpace(link.TargetType), Limit: 100,
	})
	if err != nil {
		writeLessonLinkError(response, err)
		return
	}
	for _, candidate := range created {
		if candidate.TargetType == strings.TrimSpace(link.TargetType) && candidate.TargetID == strings.TrimSpace(link.TargetID) {
			writeJSON(response, http.StatusCreated, candidate)
			return
		}
	}
	writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "created lesson link could not be reloaded"})
}

func handleLessonLinkDelete(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	err := application.Store.DeleteLessonLink(request.Context(), chi.URLParam(request, "lessonID"),
		chi.URLParam(request, "targetType"), chi.URLParam(request, "targetID"))
	if err != nil {
		writeLessonLinkError(response, err)
		return
	}
	response.WriteHeader(http.StatusNoContent)
}

func handleLessonReverseLinks(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	targetType := strings.TrimSpace(request.URL.Query().Get("target_type"))
	targetID := strings.TrimSpace(request.URL.Query().Get("target_id"))
	if targetType == "" || targetID == "" {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "target_type and target_id are required"})
		return
	}
	lessons, err := application.Store.ListLessonsForLink(request.Context(), targetType, targetID)
	if err != nil {
		writeLessonLinkError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{"items": lessons, "count": len(lessons)})
}

func writeLessonLinkError(response http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, db.ErrLessonLinkAlreadyExists):
		writeJSON(response, http.StatusConflict, map[string]string{"error": err.Error()})
	case errors.Is(err, db.ErrInvalidLessonLink):
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": err.Error()})
	case errors.Is(err, db.ErrNotFound):
		writeJSON(response, http.StatusNotFound, map[string]string{"error": err.Error()})
	default:
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "lesson link operation failed"})
	}
}
