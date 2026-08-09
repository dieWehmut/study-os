package audio

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

// Auth header styles understood by the OpenAI-compatible speech provider.
// Azure OpenAI is the only common endpoint that does not use a bearer token.
const (
	AuthBearer       = "bearer"
	AuthAPIKeyHeader = "api_key_header"
)

// SpeechSettings is the resolved configuration for one OpenAI-style speech
// endpoint. It deliberately mirrors the request body of POST /v1/audio/speech so
// OpenAI, OpenRouter, Groq, SiliconFlow, Azure OpenAI and any local server are
// one struct apart rather than one adapter apart.
type SpeechSettings struct {
	BaseURL   string
	APIKey    string
	Model     string
	Voice     string
	AuthStyle string
	Timeout   time.Duration
}

// OpenAISpeechProvider synthesizes speech through any OpenAI-compatible
// /v1/audio/speech endpoint.
//
// Unlike the CosyVoice-specific DashScopeProvider this makes no assumption about
// the vendor: the endpoint, model and voice all come from configuration, and a
// per-request override lets a saved voice role point at a different server (for
// example a local IndexTTS2) than the global default.
type OpenAISpeechProvider struct {
	settings SpeechSettings
	client   *http.Client
}

var _ Generator = (*OpenAISpeechProvider)(nil)
var _ TimelineGenerator = (*OpenAISpeechProvider)(nil)

func NewOpenAISpeechProvider(settings SpeechSettings) (*OpenAISpeechProvider, error) {
	settings.BaseURL = strings.TrimSpace(settings.BaseURL)
	if settings.BaseURL == "" {
		return nil, fmt.Errorf("%w: speech endpoint is not configured", ErrGeneratorUnavailable)
	}
	settings.APIKey = strings.TrimSpace(settings.APIKey)
	settings.Model = strings.TrimSpace(settings.Model)
	settings.Voice = strings.TrimSpace(settings.Voice)
	if settings.AuthStyle == "" {
		settings.AuthStyle = AuthBearer
	}
	if settings.Timeout <= 0 {
		// Cloned-voice engines are far slower than a hosted TTS: a local
		// IndexTTS2 run costs roughly a second of GPU time per second of audio,
		// so the 30s that suits CosyVoice would cut long sentences off.
		settings.Timeout = 120 * time.Second
	}
	return &OpenAISpeechProvider{
		settings: settings,
		client:   &http.Client{Timeout: settings.Timeout},
	}, nil
}

func (p *OpenAISpeechProvider) Name() string {
	return "speech"
}

func (p *OpenAISpeechProvider) Generate(ctx context.Context, request Request, destination string) error {
	_, err := p.GenerateWithTimeline(ctx, request, destination)
	return err
}

func (p *OpenAISpeechProvider) GenerateWithTimeline(ctx context.Context, request Request, destination string) (Timeline, error) {
	if err := ctx.Err(); err != nil {
		return Timeline{}, err
	}
	term := strings.TrimSpace(request.Term)
	if term == "" {
		return Timeline{}, fmt.Errorf("%w: term is empty", ErrNotFound)
	}

	// A voice role may point at its own server. Overrides are limited to
	// non-secret fields so a role never has to carry a credential; the global key
	// travels only to the global endpoint (see keyForEndpoint).
	endpoint := firstNonEmpty(request.BaseURL, p.settings.BaseURL)
	if endpoint == "" {
		return Timeline{}, fmt.Errorf("%w: speech endpoint is not configured", ErrGeneratorUnavailable)
	}
	speechURL, err := joinAudioPath(endpoint, "audio/speech")
	if err != nil {
		return Timeline{}, err
	}

	format, err := speechResponseFormat(request.Format)
	if err != nil {
		return Timeline{}, err
	}
	body := map[string]any{
		"model":           firstNonEmpty(request.Model, p.settings.Model),
		"input":           term,
		"response_format": format,
	}
	// Send `voice` only when one is configured. Local servers and some gateways
	// reject unknown or empty fields outright, and an absent voice means "use the
	// server default" everywhere.
	if voice := firstNonEmpty(request.Voice, p.settings.Voice); voice != "" {
		body["voice"] = voice
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return Timeline{}, fmt.Errorf("%w: encode speech request", ErrGeneratorUnavailable)
	}

	ctx, cancel := context.WithTimeout(ctx, p.settings.Timeout)
	defer cancel()
	httpRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, speechURL, bytes.NewReader(payload))
	if err != nil {
		return Timeline{}, fmt.Errorf("%w: build speech request", ErrGeneratorUnavailable)
	}
	httpRequest.Header.Set("Content-Type", "application/json")
	if key := p.keyForEndpoint(endpoint); key != "" {
		if p.settings.AuthStyle == AuthAPIKeyHeader {
			httpRequest.Header.Set("api-key", key)
		} else {
			httpRequest.Header.Set("Authorization", "Bearer "+key)
		}
	}

	response, err := p.client.Do(httpRequest)
	if err != nil {
		return Timeline{}, fmt.Errorf("%w: speech request failed", ErrGeneratorUnavailable)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		errorBody, _ := io.ReadAll(io.LimitReader(response.Body, 8<<10))
		message := speechErrorMessage(errorBody)
		if message == "" {
			message = "speech synthesis failed"
		}
		return Timeline{}, fmt.Errorf("%w: HTTP %d: %s", ErrGeneratorUnavailable, response.StatusCode, message)
	}

	audioBytes, err := io.ReadAll(io.LimitReader(response.Body, 64<<20))
	if err != nil {
		return Timeline{}, fmt.Errorf("%w: read speech response", ErrGeneratorUnavailable)
	}
	if len(audioBytes) == 0 {
		return Timeline{}, fmt.Errorf("%w: speech endpoint returned no audio", ErrGeneratorUnavailable)
	}
	// Some gateways answer a failed synthesis with HTTP 200 and a JSON error
	// body. Writing that to a .wav would poison the cache with a file that every
	// later request happily serves as "audio", so reject it here.
	if looksLikeJSON(audioBytes) {
		message := speechErrorMessage(audioBytes)
		if message == "" {
			message = "speech endpoint returned JSON instead of audio"
		}
		return Timeline{}, fmt.Errorf("%w: %s", ErrGeneratorUnavailable, message)
	}
	if err := os.WriteFile(destination, audioBytes, 0o600); err != nil {
		return Timeline{}, fmt.Errorf("%w: write synthesized audio", ErrGeneratorUnavailable)
	}

	// Only WAV carries a duration we can read back cheaply. Other containers
	// yield an empty timeline, which the service already reads as "no sidecar".
	if duration := wavDurationMS(destination); duration > 0 {
		return Timeline{Segments: []Segment{{Start: 0, End: duration, Text: term}}}, nil
	}
	return Timeline{}, nil
}

// keyForEndpoint withholds the configured credential from an endpoint the user
// did not configure it for. A voice role can redirect synthesis to any URL, and
// silently forwarding a cloud API key to that URL would leak it.
func (p *OpenAISpeechProvider) keyForEndpoint(endpoint string) string {
	if p.settings.APIKey == "" {
		return ""
	}
	if sameEndpointHost(endpoint, p.settings.BaseURL) {
		return p.settings.APIKey
	}
	return ""
}

func sameEndpointHost(left, right string) bool {
	leftURL, leftErr := url.Parse(strings.TrimSpace(left))
	rightURL, rightErr := url.Parse(strings.TrimSpace(right))
	if leftErr != nil || rightErr != nil {
		return false
	}
	return strings.EqualFold(leftURL.Host, rightURL.Host)
}

// joinAudioPath appends an OpenAI audio path to a configured API base. A base
// that already names an audio endpoint is used verbatim, because Azure
// deployments and some gateways hand out a full URL whose query string
// (?api-version=...) must survive.
func joinAudioPath(baseURL, suffix string) (string, error) {
	base := strings.TrimSpace(baseURL)
	if base == "" {
		return "", fmt.Errorf("%w: speech endpoint is not configured", ErrGeneratorUnavailable)
	}
	head, query, hasQuery := strings.Cut(base, "?")
	if strings.Contains(head, "/audio/") {
		return base, nil
	}
	joined := strings.TrimRight(head, "/") + "/" + strings.TrimLeft(suffix, "/")
	if hasQuery {
		return joined + "?" + query, nil
	}
	return joined, nil
}

// speechResponseFormat maps the cache's container choice onto the format names
// the OpenAI audio API understands. The service decides the file extension up
// front, so the request has to ask for exactly that container.
func speechResponseFormat(format string) (string, error) {
	normalized, err := normalizedFormat(format)
	if err != nil {
		return "", err
	}
	switch normalized {
	case "ogg":
		return "opus", nil
	case "m4a":
		return "aac", nil
	default:
		return normalized, nil
	}
}

func speechErrorMessage(body []byte) string {
	var payload struct {
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
		Message string `json:"message"`
		Detail  string `json:"detail"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return ""
	}
	for _, candidate := range []string{payload.Error.Message, payload.Message, payload.Detail} {
		if trimmed := strings.TrimSpace(candidate); trimmed != "" {
			if len(trimmed) > 200 {
				return trimmed[:200]
			}
			return trimmed
		}
	}
	return ""
}

func looksLikeJSON(content []byte) bool {
	trimmed := bytes.TrimLeft(content, " \t\r\n")
	return len(trimmed) > 0 && (trimmed[0] == '{' || trimmed[0] == '[')
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}
