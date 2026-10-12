package httpapi

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"study-os/backend/app"
	"study-os/backend/db"
)

// handleKnowledgeArchive hides an item from the default library view, or brings it back.
//
// Neither direction deletes anything (ROADMAP §8.1): 归档 writes one column, and the item
// keeps its cards, its review states and every attempt. That is not politeness -- a prompt
// that was ever answered cannot be deleted at all (`attempts.prompt_id REFERENCES
// prompts(id) ON DELETE RESTRICT`), so "delete the item" would either fail or take
// evidence with it.
//
// POST archives, DELETE unarchives, and both are idempotent: pressing twice answers the
// same thing rather than complaining, the way 排进复习 and 取消排复习 do.
func handleKnowledgeArchive(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	ctx := request.Context()
	item, err := application.Store.GetKnowledgeItem(ctx, chi.URLParam(request, "knowledgeID"))
	if err != nil {
		writeStoreError(response, err)
		return
	}

	archived := request.Method == http.MethodPost
	if err := application.Store.SetKnowledgeArchived(ctx, item.ID, archived); err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeStoreError(response, err)
			return
		}
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "归档失败"})
		return
	}

	status := "archived"
	if !archived {
		status = "unarchived"
	}
	writeJSON(response, http.StatusOK, map[string]any{
		"status":       status,
		"knowledge_id": item.ID,
	})
}
