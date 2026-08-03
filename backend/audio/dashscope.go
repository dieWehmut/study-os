package audio

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
)

const defaultDashScopeBaseURL = "https://dashscope.aliyuncs.com"

// DashScopeProvider synthesizes speech through the DashScope CosyVoice
// multimodal-generation HTTP API and writes the resulting WAV to the cache
// destination. The protocol returns base64 audio chunks as SSE events; a
// single utterance segment is derived from the WAV duration.
type DashScopeProvider struct {
	apiKey  string
	voice   string
	baseURL string
}

var _ Generator = (*DashScopeProvider)(nil)
var _ TimelineGenerator = (*DashScopeProvider)(nil)

func NewDashScopeProvider(apiKey, voice string) (*DashScopeProvider, error) {
	if strings.TrimSpace(apiKey) == "" {
		return nil, fmt.Errorf("%w: DashScope API key is not configured", ErrGeneratorUnavailable)
	}
	if strings.TrimSpace(voice) == "" {
		voice = "longxiaochun"
	}
	return &DashScopeProvider{
		apiKey:  strings.TrimSpace(apiKey),
		voice:   strings.TrimSpace(voice),
		baseURL: defaultDashScopeBaseURL,
	}, nil
}

func (p *DashScopeProvider) Name() string {
	return "dashscope"
}

func (p *DashScopeProvider) Generate(ctx context.Context, request Request, destination string) error {
	_, err := p.GenerateWithTimeline(ctx, request, destination)
	return err
}

func (p *DashScopeProvider) GenerateWithTimeline(ctx context.Context, request Request, destination string) (Timeline, error) {
	if err := ctx.Err(); err != nil {
		return Timeline{}, err
	}
	term := strings.TrimSpace(request.Term)
	if term == "" {
		return Timeline{}, fmt.Errorf("%w: term is empty", ErrNotFound)
	}
	body := map[string]any{
		"model": "cosyvoice-v2",
		"input": map[string]string{"text": term},
		"parameters": map[string]string{
			"voice":  p.voice,
			"format": "wav",
		},
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return Timeline{}, fmt.Errorf("%w: encode synthesis request", ErrGeneratorUnavailable)
	}
	endpoint := strings.TrimRight(p.baseURL, "/") + "/api/v1/services/aigc/multimodal-generation/generation"
	httpRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return Timeline{}, fmt.Errorf("%w: build synthesis request", ErrGeneratorUnavailable)
	}
	httpRequest.Header.Set("Authorization", "Bearer "+p.apiKey)
	httpRequest.Header.Set("Content-Type", "application/json")

	response, err := http.DefaultClient.Do(httpRequest)
	if err != nil {
		return Timeline{}, fmt.Errorf("%w: synthesis request failed", ErrGeneratorUnavailable)
	}
	defer response.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(response.Body, 16<<20))
	if err != nil {
		return Timeline{}, fmt.Errorf("%w: read synthesis response", ErrGeneratorUnavailable)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		message := dashScopeErrorMessage(responseBody)
		if message == "" {
			message = "DashScope synthesis failed"
		}
		return Timeline{}, fmt.Errorf("%w: HTTP %d: %s", ErrGeneratorUnavailable, response.StatusCode, message)
	}

	var audio bytes.Buffer
	for _, line := range strings.Split(string(responseBody), "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		payload := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if payload == "" || payload == "[DONE]" {
			continue
		}
		var event struct {
			Output struct {
				Audio  string `json:"audio"`
				Action string `json:"action"`
			} `json:"output"`
		}
		if err := json.Unmarshal([]byte(payload), &event); err != nil {
			continue
		}
		if event.Output.Action == "task-failed" {
			return Timeline{}, fmt.Errorf("%w: DashScope synthesis task failed", ErrGeneratorUnavailable)
		}
		if event.Output.Audio != "" {
			chunk, err := base64.StdEncoding.DecodeString(event.Output.Audio)
			if err != nil {
				return Timeline{}, fmt.Errorf("%w: decode audio chunk", ErrGeneratorUnavailable)
			}
			_, _ = audio.Write(chunk)
		}
	}
	if audio.Len() == 0 {
		return Timeline{}, fmt.Errorf("%w: DashScope returned no audio", ErrGeneratorUnavailable)
	}
	if err := os.WriteFile(destination, audio.Bytes(), 0o600); err != nil {
		return Timeline{}, fmt.Errorf("%w: write synthesized audio", ErrGeneratorUnavailable)
	}
	return Timeline{Segments: []Segment{{
		Start: 0,
		End:   wavDurationMS(destination),
		Text:  term,
	}}}, nil
}

func dashScopeErrorMessage(body []byte) string {
	var payload struct {
		Message string `json:"message"`
	}
	if err := json.Unmarshal(body, &payload); err != nil || strings.TrimSpace(payload.Message) == "" {
		return ""
	}
	return strings.TrimSpace(payload.Message)
}

func wavDurationMS(path string) int64 {
	file, err := os.Open(path)
	if err != nil {
		return 0
	}
	defer file.Close()
	header := make([]byte, 44)
	if _, err := io.ReadFull(file, header); err != nil {
		return 0
	}
	if string(header[0:4]) != "RIFF" || string(header[8:12]) != "WAVE" {
		return 0
	}
	sampleRate := binary.LittleEndian.Uint32(header[24:28])
	if sampleRate == 0 {
		return 0
	}
	dataSize := binary.LittleEndian.Uint32(header[40:44])
	return int64(dataSize) * 1000 / int64(sampleRate)
}
