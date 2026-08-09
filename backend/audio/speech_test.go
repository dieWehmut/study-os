package audio

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestOpenAISpeechProviderPostsOpenAIShapedRequest(t *testing.T) {
	wav := makeWAV(24000, 48000)
	var captured map[string]any
	var path, authorization, contentType string
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		path = request.URL.Path
		authorization = request.Header.Get("Authorization")
		contentType = request.Header.Get("Content-Type")
		if err := decodeJSONBody(request, &captured); err != nil {
			t.Errorf("decode request body: %v", err)
		}
		response.Header().Set("Content-Type", "audio/wav")
		_, _ = response.Write(wav)
	}))
	defer server.Close()

	provider, err := NewOpenAISpeechProvider(SpeechSettings{
		BaseURL: server.URL + "/v1", APIKey: "speech-key", Model: "tts-1", Voice: "alloy",
	})
	if err != nil {
		t.Fatalf("create provider: %v", err)
	}
	destination := filepath.Join(t.TempDir(), "audio.wav")
	timeline, err := provider.GenerateWithTimeline(context.Background(),
		Request{Term: "abandon", Format: "wav"}, destination)
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	if path != "/v1/audio/speech" {
		t.Fatalf("path = %q, want /v1/audio/speech", path)
	}
	if authorization != "Bearer speech-key" {
		t.Fatalf("authorization = %q", authorization)
	}
	if contentType != "application/json" {
		t.Fatalf("content type = %q", contentType)
	}
	if captured["model"] != "tts-1" || captured["input"] != "abandon" ||
		captured["voice"] != "alloy" || captured["response_format"] != "wav" {
		t.Fatalf("request body = %#v", captured)
	}
	got, err := os.ReadFile(destination)
	if err != nil {
		t.Fatalf("read generated audio: %v", err)
	}
	if string(got) != string(wav) {
		t.Fatalf("generated audio differs: %d bytes vs %d", len(got), len(wav))
	}
	if len(timeline.Segments) != 1 || timeline.Segments[0].End <= 0 {
		t.Fatalf("timeline = %#v", timeline.Segments)
	}
}

// A voice role may point at its own server. The endpoint, model and voice must
// follow the role rather than the global defaults.
func TestOpenAISpeechProviderPrefersPerRequestOverrides(t *testing.T) {
	var captured map[string]any
	roleServer := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if err := decodeJSONBody(request, &captured); err != nil {
			t.Errorf("decode request body: %v", err)
		}
		_, _ = response.Write(makeWAV(24000, 24000))
	}))
	defer roleServer.Close()

	provider, err := NewOpenAISpeechProvider(SpeechSettings{
		BaseURL: "https://api.openai.com/v1", APIKey: "global-key", Model: "tts-1", Voice: "alloy",
	})
	if err != nil {
		t.Fatalf("create provider: %v", err)
	}
	destination := filepath.Join(t.TempDir(), "audio.wav")
	if _, err := provider.GenerateWithTimeline(context.Background(), Request{
		Term: "night city", Format: "wav",
		BaseURL: roleServer.URL + "/v1", Model: "indextts-2", Voice: "johnny",
	}, destination); err != nil {
		t.Fatalf("generate: %v", err)
	}
	if captured["model"] != "indextts-2" || captured["voice"] != "johnny" {
		t.Fatalf("overrides were not applied: %#v", captured)
	}
}

// The configured credential belongs to the configured endpoint. A role that
// redirects synthesis elsewhere must not carry the key to that host.
func TestOpenAISpeechProviderWithholdsKeyFromForeignEndpoint(t *testing.T) {
	var authorization string
	var sawHeader bool
	foreign := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		authorization = request.Header.Get("Authorization")
		_, sawHeader = request.Header["Authorization"]
		_, _ = response.Write(makeWAV(24000, 24000))
	}))
	defer foreign.Close()

	provider, err := NewOpenAISpeechProvider(SpeechSettings{
		BaseURL: "https://api.openai.com/v1", APIKey: "sk-live-secret", Model: "tts-1",
	})
	if err != nil {
		t.Fatalf("create provider: %v", err)
	}
	destination := filepath.Join(t.TempDir(), "audio.wav")
	if _, err := provider.GenerateWithTimeline(context.Background(),
		Request{Term: "abandon", Format: "wav", BaseURL: foreign.URL + "/v1"}, destination); err != nil {
		t.Fatalf("generate: %v", err)
	}
	if sawHeader || authorization != "" {
		t.Fatalf("global key leaked to a role endpoint: %q", authorization)
	}
}

func TestOpenAISpeechProviderUsesAzureAuthStyle(t *testing.T) {
	var apiKeyHeader, authorization, rawQuery string
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		apiKeyHeader = request.Header.Get("api-key")
		authorization = request.Header.Get("Authorization")
		rawQuery = request.URL.RawQuery
		_, _ = response.Write(makeWAV(24000, 24000))
	}))
	defer server.Close()

	// Azure hands out a full deployment URL whose api-version query must survive.
	provider, err := NewOpenAISpeechProvider(SpeechSettings{
		BaseURL:   server.URL + "/openai/deployments/tts/audio/speech?api-version=2024-05-01",
		APIKey:    "azure-key",
		AuthStyle: AuthAPIKeyHeader,
		Model:     "tts-1",
	})
	if err != nil {
		t.Fatalf("create provider: %v", err)
	}
	destination := filepath.Join(t.TempDir(), "audio.wav")
	if _, err := provider.GenerateWithTimeline(context.Background(),
		Request{Term: "abandon", Format: "wav"}, destination); err != nil {
		t.Fatalf("generate: %v", err)
	}
	if apiKeyHeader != "azure-key" {
		t.Fatalf("api-key header = %q", apiKeyHeader)
	}
	if authorization != "" {
		t.Fatalf("azure must not receive a bearer token: %q", authorization)
	}
	if rawQuery != "api-version=2024-05-01" {
		t.Fatalf("api-version query was dropped: %q", rawQuery)
	}
}

// Local servers and strict gateways reject unknown or empty fields, so an
// unconfigured voice must be absent rather than sent as "".
func TestOpenAISpeechProviderOmitsVoiceWhenUnset(t *testing.T) {
	var captured map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if err := decodeJSONBody(request, &captured); err != nil {
			t.Errorf("decode request body: %v", err)
		}
		_, _ = response.Write(makeWAV(24000, 24000))
	}))
	defer server.Close()

	provider, err := NewOpenAISpeechProvider(SpeechSettings{BaseURL: server.URL + "/v1", Model: "indextts-2"})
	if err != nil {
		t.Fatalf("create provider: %v", err)
	}
	destination := filepath.Join(t.TempDir(), "audio.wav")
	if _, err := provider.GenerateWithTimeline(context.Background(),
		Request{Term: "abandon", Format: "wav"}, destination); err != nil {
		t.Fatalf("generate: %v", err)
	}
	if _, present := captured["voice"]; present {
		t.Fatalf("voice must be omitted when unset: %#v", captured)
	}
}

// Vendors do treat voice names as case-sensitive, so the spelling the user saved
// has to survive normalization all the way to the request body.
func TestSpeechRequestPreservesVoiceCaseButKeysCaseInsensitively(t *testing.T) {
	mixed := Request{Term: "abandon", Voice: "FunAudioLLM/CosyVoice2-0.5B:Alex", Format: "wav"}
	if got := normalizeRequest(mixed).Voice; got != "FunAudioLLM/CosyVoice2-0.5B:Alex" {
		t.Fatalf("voice case was lost: %q", got)
	}
	lower := Request{Term: "abandon", Voice: "funaudiollm/cosyvoice2-0.5b:alex", Format: "wav"}
	if CacheKey(mixed) != CacheKey(lower) {
		t.Fatalf("cache key must ignore voice case")
	}
}

// A different endpoint or model is a different voice, so it must not serve the
// audio cached for the previous configuration.
func TestCacheKeySeparatesSpeechEndpointsAndModels(t *testing.T) {
	base := Request{Term: "abandon", Format: "wav"}
	local := base
	local.BaseURL = "http://127.0.0.1:8100/v1"
	hosted := base
	hosted.BaseURL = "https://api.openai.com/v1"
	if CacheKey(local) == CacheKey(hosted) {
		t.Fatalf("endpoints must not share a cache entry")
	}
	firstModel, secondModel := base, base
	firstModel.Model = "tts-1"
	secondModel.Model = "indextts-2"
	if CacheKey(firstModel) == CacheKey(secondModel) {
		t.Fatalf("models must not share a cache entry")
	}
}

func TestOpenAISpeechProviderClassifiesHTTPFailureAsRecoverable(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.WriteHeader(http.StatusUnauthorized)
		_, _ = response.Write([]byte(`{"error":{"message":"invalid api key"}}`))
	}))
	defer server.Close()

	provider, err := NewOpenAISpeechProvider(SpeechSettings{BaseURL: server.URL + "/v1", APIKey: "bad", Model: "tts-1"})
	if err != nil {
		t.Fatalf("create provider: %v", err)
	}
	destination := filepath.Join(t.TempDir(), "audio.wav")
	_, err = provider.GenerateWithTimeline(context.Background(), Request{Term: "abandon", Format: "wav"}, destination)
	if err == nil {
		t.Fatal("expected an error")
	}
	if !errors.Is(err, ErrGeneratorUnavailable) || !IsRecoverable(err) {
		t.Fatalf("error must let the chain fall back to local speech: %v", err)
	}
	// The vendor's own explanation is the useful part of the message.
	if !strings.Contains(err.Error(), "invalid api key") {
		t.Fatalf("error message lost the vendor detail: %v", err)
	}
}

// Some gateways answer a failed synthesis with HTTP 200 and a JSON error body.
// Writing that to the cache would make every later request serve a "wav" that is
// really an error document.
func TestOpenAISpeechProviderRejectsJSONBodyServedAsAudio(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("Content-Type", "audio/wav")
		_, _ = response.Write([]byte(`{"error":{"message":"quota exceeded"}}`))
	}))
	defer server.Close()

	provider, err := NewOpenAISpeechProvider(SpeechSettings{BaseURL: server.URL + "/v1", Model: "tts-1"})
	if err != nil {
		t.Fatalf("create provider: %v", err)
	}
	destination := filepath.Join(t.TempDir(), "audio.wav")
	_, err = provider.GenerateWithTimeline(context.Background(), Request{Term: "abandon", Format: "wav"}, destination)
	if err == nil {
		t.Fatal("expected JSON served as audio to be rejected")
	}
	if !IsRecoverable(err) || !strings.Contains(err.Error(), "quota exceeded") {
		t.Fatalf("unexpected error: %v", err)
	}
	if _, statErr := os.Stat(destination); statErr == nil {
		if content, _ := os.ReadFile(destination); len(content) > 0 {
			t.Fatalf("the cache was poisoned with a JSON error body: %s", content)
		}
	}
}

func TestSpeechResponseFormatMapsContainersToOpenAINames(t *testing.T) {
	cases := map[string]string{"wav": "wav", "mp3": "mp3", "ogg": "opus", "m4a": "aac", "": "wav"}
	for input, want := range cases {
		got, err := speechResponseFormat(input)
		if err != nil {
			t.Fatalf("format %q: %v", input, err)
		}
		if got != want {
			t.Fatalf("format %q = %q, want %q", input, got, want)
		}
	}
	if _, err := speechResponseFormat("midi"); !errors.Is(err, ErrUnsupportedFormat) {
		t.Fatalf("unsupported format error = %v", err)
	}
}

func TestJoinAudioPathKeepsAnAlreadyCompleteEndpoint(t *testing.T) {
	joined, err := joinAudioPath("https://example.test/v1", "audio/speech")
	if err != nil {
		t.Fatalf("join: %v", err)
	}
	if joined != "https://example.test/v1/audio/speech" {
		t.Fatalf("joined = %q", joined)
	}
	verbatim, err := joinAudioPath("https://example.test/deployments/x/audio/speech?api-version=1", "audio/speech")
	if err != nil {
		t.Fatalf("join: %v", err)
	}
	if verbatim != "https://example.test/deployments/x/audio/speech?api-version=1" {
		t.Fatalf("verbatim = %q", verbatim)
	}
}

// Voice roles are runtime rows, added long after the generator chain is built.
// A provider that refused to exist without a startup endpoint could never serve
// a role created later, so the endpoint requirement belongs at synthesis time --
// where a request carrying no endpoint at all still reports unavailable.
func TestNewOpenAISpeechProviderAcceptsARoleSuppliedEndpoint(t *testing.T) {
	provider, err := NewOpenAISpeechProvider(SpeechSettings{Model: "tts-1"})
	if err != nil {
		t.Fatalf("create provider without a global endpoint: %v", err)
	}

	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		_, _ = response.Write(makeWAV(24000, 24000))
	}))
	defer server.Close()

	destination := filepath.Join(t.TempDir(), "audio.wav")
	if _, err := provider.GenerateWithTimeline(context.Background(),
		Request{Term: "abandon", Format: "wav", BaseURL: server.URL + "/v1"}, destination); err != nil {
		t.Fatalf("generate against a role endpoint: %v", err)
	}
}

func TestOpenAISpeechProviderReportsUnavailableWithNoEndpointAnywhere(t *testing.T) {
	provider, err := NewOpenAISpeechProvider(SpeechSettings{Model: "tts-1"})
	if err != nil {
		t.Fatalf("create provider without a global endpoint: %v", err)
	}
	destination := filepath.Join(t.TempDir(), "audio.wav")
	_, err = provider.GenerateWithTimeline(context.Background(),
		Request{Term: "abandon", Format: "wav"}, destination)
	if !errors.Is(err, ErrGeneratorUnavailable) {
		t.Fatalf("error = %v, want ErrGeneratorUnavailable", err)
	}
}

// http://host and https://host are not the same endpoint. Comparing only the
// host sends the bearer token in cleartext to whoever answers port 80, and a
// user typing the scheme by hand is all it takes.
func TestOpenAISpeechProviderWithholdsKeyFromAPlaintextTwinOfItsEndpoint(t *testing.T) {
	var authorization string
	var sawHeader bool
	twin := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		authorization = request.Header.Get("Authorization")
		_, sawHeader = request.Header["Authorization"]
		_, _ = response.Write(makeWAV(24000, 24000))
	}))
	defer twin.Close()

	secure := "https" + strings.TrimPrefix(twin.URL, "http") + "/v1"
	provider, err := NewOpenAISpeechProvider(SpeechSettings{
		BaseURL: secure, APIKey: "sk-live-secret", Model: "tts-1",
	})
	if err != nil {
		t.Fatalf("create provider: %v", err)
	}
	destination := filepath.Join(t.TempDir(), "audio.wav")
	if _, err := provider.GenerateWithTimeline(context.Background(),
		Request{Term: "abandon", Format: "wav", BaseURL: twin.URL + "/v1"}, destination); err != nil {
		t.Fatalf("generate: %v", err)
	}
	if sawHeader || authorization != "" {
		t.Fatalf("key leaked to the http:// twin of the configured endpoint: %q", authorization)
	}
}
