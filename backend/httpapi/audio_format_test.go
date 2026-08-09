package httpapi

import (
	"net/http/httptest"
	"testing"

	"study-os/backend/app"
	"study-os/backend/config"
)

// The 音频格式 setting is saved, validated, persisted and rendered as a picker.
// It is only a real setting if something reads it: the container the request
// asks for is what the picker is choosing, and a caller that omits the query
// parameter is asking for the configured default rather than for WAV.
func TestAudioRequestFallsBackToTheConfiguredFormat(t *testing.T) {
	application := &app.App{Config: config.Config{
		SpeechSettings: config.SpeechConfig{Provider: "custom", Format: "mp3"},
	}}
	request := httptest.NewRequest("POST", "http://127.0.0.1/api/audio?term=abandon", nil)

	got := audioRequestFromQuery(request, application)

	if got.Format != "mp3" {
		t.Fatalf("Format = %q, want the configured mp3", got.Format)
	}
}

// An explicit format still wins. The reading pipeline asks for wav on purpose --
// only WAV carries a duration the timeline sidecar can read back -- so a global
// preference must not override a caller that named its container.
func TestAudioRequestKeepsAnExplicitFormatOverTheConfiguredOne(t *testing.T) {
	application := &app.App{Config: config.Config{
		SpeechSettings: config.SpeechConfig{Provider: "custom", Format: "mp3"},
	}}
	request := httptest.NewRequest("POST", "http://127.0.0.1/api/audio?term=abandon&format=wav", nil)

	got := audioRequestFromQuery(request, application)

	if got.Format != "wav" {
		t.Fatalf("Format = %q, want the requested wav", got.Format)
	}
}
