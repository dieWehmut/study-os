package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"study-os/backend/app"
	"study-os/backend/audio"
	"study-os/backend/config"
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
	input := audioRequestFromQuery(request, application)
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
	input := audioRequestFromQuery(request, application)
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

// audioRequestFromQuery builds the synthesis request and layers the selected
// voice role on top. Playback and timeline lookups share it because both derive
// the same cache key, and a role that only one of them applied would make the
// timeline sidecar unreachable.
func audioRequestFromQuery(request *http.Request, application *app.App) audio.Request {
	query := request.URL.Query()
	input := audio.Request{
		Term:      query.Get("term"),
		Locale:    query.Get("locale"),
		Voice:     query.Get("voice"),
		Format:    query.Get("format"),
		Provider:  query.Get("provider"),
		LocalPath: query.Get("local_path"),
	}
	if application == nil || application.Store == nil {
		return input
	}
	roleID := strings.TrimSpace(query.Get("role"))
	if roleID == "" {
		roleID, _ = application.Store.ActiveVoiceRoleID(request.Context())
	}
	if roleID == "" {
		return input
	}
	role, err := application.Store.GetVoiceRole(request.Context(), roleID)
	if err != nil {
		// A deleted or unreadable role falls back to the global voice. Losing the
		// persona is a smaller failure than losing pronunciation entirely.
		return input
	}
	baseURL := role.BaseURL
	if baseURL == "" {
		if spec, ok := config.LookupSpeechProvider(role.Provider); ok {
			baseURL = spec.BaseURL
		}
	}
	input.BaseURL = baseURL
	input.Model = role.Model
	if role.Voice != "" {
		input.Voice = role.Voice
	}
	// Tag the cache entry with the role so two roles reading the same word keep
	// separate audio instead of overwriting each other.
	input.Provider = "role:" + role.ID
	return input
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
