package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"study-os/backend/app"
	"study-os/backend/audio"
	"study-os/backend/models"
)

const audioGenerationHeader = "X-Study-OS-Request"

func handleAudio(response http.ResponseWriter, request *http.Request, application *app.App) {
	handleAudioRequest(response, request, application, false)
}

func handleAudioGenerate(response http.ResponseWriter, request *http.Request, application *app.App) {
	if request.Header.Get(audioGenerationHeader) != "1" {
		writeJSON(response, http.StatusForbidden, map[string]string{"error": "audio generation request header is required"})
		return
	}
	handleAudioRequest(response, request, application, true)
}

func handleAudioRequest(response http.ResponseWriter, request *http.Request, application *app.App, generate bool) {
	if application == nil || application.Audio == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "audio service unavailable"})
		return
	}
	input := audio.Request{
		Term:      request.URL.Query().Get("term"),
		Locale:    request.URL.Query().Get("locale"),
		Voice:     request.URL.Query().Get("voice"),
		Format:    request.URL.Query().Get("format"),
		Provider:  request.URL.Query().Get("provider"),
		LocalPath: request.URL.Query().Get("local_path"),
	}
	if strings.TrimSpace(input.Term) == "" && strings.TrimSpace(input.LocalPath) == "" {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "term or local_path is required"})
		return
	}
	var opened *audio.Opened
	var err error
	if generate {
		opened, err = application.Audio.Open(request.Context(), input)
	} else {
		opened, err = application.Audio.OpenExisting(request.Context(), input)
	}
	if err != nil {
		status := http.StatusNotFound
		if errors.Is(err, audio.ErrUnsafePath) || errors.Is(err, audio.ErrUnsupportedFormat) {
			status = http.StatusBadRequest
		} else if errors.Is(err, audio.ErrGeneratorUnavailable) {
			// A missing local generator is a retryable service condition, not a
			// missing asset. Keep the distinction visible to clients.
			status = http.StatusServiceUnavailable
		} else if !errors.Is(err, audio.ErrNotFound) {
			status = http.StatusInternalServerError
		}
		writeJSON(response, status, map[string]string{"error": audioErrorMessage(err)})
		return
	}
	defer opened.Close()
	if generate && opened.Source == audio.SourceGenerated {
		recordGeneratedAudio(request, application, opened, input)
	}
	response.Header().Set("Accept-Ranges", "bytes")
	response.Header().Set("Cache-Control", "private, max-age=86400")
	http.ServeContent(response, request, opened.Asset.Name, opened.Asset.ModTime, opened.File)
}

func handleAudioTimeline(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Audio == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "audio service unavailable"})
		return
	}
	input := audio.Request{
		Term:      request.URL.Query().Get("term"),
		Locale:    request.URL.Query().Get("locale"),
		Voice:     request.URL.Query().Get("voice"),
		Format:    request.URL.Query().Get("format"),
		Provider:  request.URL.Query().Get("provider"),
		LocalPath: request.URL.Query().Get("local_path"),
	}
	if strings.TrimSpace(input.Term) == "" && strings.TrimSpace(input.LocalPath) == "" {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "term or local_path is required"})
		return
	}
	timeline, err := application.Audio.Timeline(request.Context(), input)
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "read audio timeline failed"})
		return
	}
	writeJSON(response, http.StatusOK, timeline)
}

func recordGeneratedAudio(request *http.Request, application *app.App, opened *audio.Opened, input audio.Request) {
	if application == nil || application.Store == nil {
		return
	}
	timeline, err := application.Audio.Timeline(request.Context(), input)
	if err != nil {
		timeline = audio.Timeline{}
	}
	encoded, err := json.Marshal(timeline)
	if err != nil {
		return
	}
	_ = application.Store.UpsertAudioAsset(request.Context(), models.AudioAsset{
		ID:           opened.Key,
		SourceType:   string(opened.Source),
		URI:          opened.Asset.Name,
		Provider:     strings.ToLower(strings.TrimSpace(input.Provider)),
		Voice:        strings.ToLower(strings.TrimSpace(input.Voice)),
		TimelineJSON: encoded,
		CreatedAt:    time.Now().UTC(),
	})
}

func audioErrorMessage(err error) string {
	if errors.Is(err, audio.ErrGeneratorUnavailable) {
		return "pronunciation audio is unavailable offline"
	}
	if errors.Is(err, audio.ErrNotFound) {
		return "pronunciation audio was not found"
	}
	if errors.Is(err, audio.ErrUnsafePath) {
		return "audio path is unsafe"
	}
	if errors.Is(err, audio.ErrUnsupportedFormat) {
		return "audio format is unsupported"
	}
	return "audio request failed"
}
