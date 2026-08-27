package httpapi

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"study-os/backend/app"
)

// handleKnowledgeMastery returns the evidence projection for one knowledge
// item. The projection is derived from existing prompts and attempts; this
// endpoint does not create a second, independently mutable mastery record.
func handleKnowledgeMastery(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	projection, err := application.Store.GetKnowledgeMastery(request.Context(), chi.URLParam(request, "knowledgeID"))
	if err != nil {
		writeStoreError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, projection)
}
