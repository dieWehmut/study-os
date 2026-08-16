package httpapi

import (
	"errors"
	"net/http"
	"strings"

	"study-os/backend/app"
	"study-os/backend/knowledge"
)

type vocabularyLookupRequest struct {
	Term    string `json:"term"`
	Context string `json:"context"`
	Kind    string `json:"kind"`
}

func handleVocabularyLookup(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "knowledge service unavailable"})
		return
	}
	request.Body = http.MaxBytesReader(response, request.Body, maxImportJSONBytes)
	var input vocabularyLookupRequest
	if err := decodeRequest(request, &input); err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	// A local hit must remain available even when the configured provider is
	// absent. The service receives nil and reports ErrProvider only after its
	// exact lookup misses.
	provider, providerErr := providerFor(application)
	if providerErr != nil {
		provider = nil
	}
	result, err := knowledge.LookupVocabulary(request.Context(), application.Store, provider, knowledge.LookupInput{
		Term: input.Term, Context: input.Context, Kind: knowledge.Kind(strings.ToLower(strings.TrimSpace(input.Kind))),
	})
	if err != nil {
		switch {
		case errors.Is(err, knowledge.ErrInvalidInput):
			writeJSON(response, http.StatusBadRequest, map[string]string{"error": err.Error()})
		case errors.Is(err, knowledge.ErrProvider):
			if providerErr != nil {
				writeJSON(response, http.StatusServiceUnavailable, map[string]any{"error": "AI provider is not configured", "error_class": "config_missing"})
			} else {
				writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": err.Error()})
			}
		default:
			writeJSON(response, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		}
		return
	}
	status := http.StatusOK
	if result.Source == knowledge.SourceGenerated {
		status = http.StatusCreated
	}
	writeJSON(response, status, result)
}
