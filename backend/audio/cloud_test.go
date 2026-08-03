package audio

import (
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func makeWAV(sampleRate uint32, dataSize uint32) []byte {
	const headerSize = 44
	wav := make([]byte, headerSize+dataSize)
	copy(wav[0:4], "RIFF")
	binary.LittleEndian.PutUint32(wav[4:8], 36+dataSize)
	copy(wav[8:12], "WAVE")
	copy(wav[12:16], "fmt ")
	binary.LittleEndian.PutUint32(wav[16:20], 16)
	binary.LittleEndian.PutUint16(wav[20:22], 1)
	binary.LittleEndian.PutUint16(wav[22:24], 1)
	binary.LittleEndian.PutUint32(wav[24:28], sampleRate)
	binary.LittleEndian.PutUint32(wav[28:32], sampleRate*2)
	binary.LittleEndian.PutUint16(wav[32:34], 2)
	binary.LittleEndian.PutUint16(wav[34:36], 16)
	copy(wav[36:40], "data")
	binary.LittleEndian.PutUint32(wav[40:44], dataSize)
	for index := range wav[44:] {
		wav[44+index] = byte(index % 7)
	}
	return wav
}

func TestCacheKeySeparatesProviders(t *testing.T) {
	dashscope := Request{Term: "abandon", Provider: "dashscope", Voice: "longxiaochun"}
	sapi := Request{Term: "abandon", Provider: "sapi", Voice: "longxiaochun"}
	if CacheKey(dashscope) == CacheKey(sapi) {
		t.Fatal("different providers must not share a cache entry")
	}
	empty := Request{Term: "abandon"}
	explicitEmpty := Request{Term: "abandon", Provider: "  "}
	if CacheKey(empty) != CacheKey(explicitEmpty) {
		t.Fatal("empty and whitespace providers must normalize to the same key")
	}
}

func TestDashScopeProviderGeneratesWavFromSSE(t *testing.T) {
	wav := makeWAV(16000, 32000)
	var captured map[string]any
	var authorization string
	var path string
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		path = request.URL.Path
		authorization = request.Header.Get("Authorization")
		if err := decodeJSONBody(request, &captured); err != nil {
			t.Errorf("decode request body: %v", err)
		}
		encoded := base64.StdEncoding.EncodeToString(wav)
		response.Header().Set("Content-Type", "text/event-stream")
		_, _ = response.Write([]byte("data: {\"output\":{\"audio\":\"" + encoded + "\",\"action\":\"task-in-progress\"}}\n\n"))
		_, _ = response.Write([]byte("data: {\"output\":{\"action\":\"task-succeeded\"}}\n\ndata: [DONE]\n\n"))
	}))
	defer server.Close()

	provider, err := NewDashScopeProvider("dashscope-key", "longxiaochun")
	if err != nil {
		t.Fatalf("create provider: %v", err)
	}
	provider.baseURL = server.URL
	destination := filepath.Join(t.TempDir(), "audio.wav")
	timeline, err := provider.GenerateWithTimeline(context.Background(), Request{Term: "abandon"}, destination)
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	if path != "/api/v1/services/aigc/multimodal-generation/generation" {
		t.Fatalf("path = %q", path)
	}
	if authorization != "Bearer dashscope-key" {
		t.Fatalf("authorization = %q", authorization)
	}
	if captured["model"] != "cosyvoice-v2" {
		t.Fatalf("model = %#v", captured["model"])
	}
	parameters, _ := captured["parameters"].(map[string]any)
	if parameters["voice"] != "longxiaochun" {
		t.Fatalf("voice = %#v", parameters["voice"])
	}
	input, _ := captured["input"].(map[string]any)
	if input["text"] != "abandon" {
		t.Fatalf("text = %#v", input["text"])
	}
	got, err := os.ReadFile(destination)
	if err != nil {
		t.Fatalf("read generated audio: %v", err)
	}
	if string(got) != string(wav) {
		t.Fatalf("generated audio differs: %d bytes vs %d", len(got), len(wav))
	}
	if len(timeline.Segments) != 1 || timeline.Segments[0].Text != "abandon" {
		t.Fatalf("timeline = %#v", timeline.Segments)
	}
	if timeline.Segments[0].End <= 0 {
		t.Fatalf("timeline end must reflect wav duration: %#v", timeline.Segments[0])
	}
}

func TestDashScopeProviderClassifiesHTTPFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.WriteHeader(http.StatusUnauthorized)
		_, _ = response.Write([]byte(`{"message":"invalid api key"}`))
	}))
	defer server.Close()
	provider, err := NewDashScopeProvider("dashscope-key", "longxiaochun")
	if err != nil {
		t.Fatalf("create provider: %v", err)
	}
	provider.baseURL = server.URL
	err = provider.Generate(context.Background(), Request{Term: "abandon"}, filepath.Join(t.TempDir(), "audio.wav"))
	if !errors.Is(err, ErrGeneratorUnavailable) {
		t.Fatalf("error = %v, want ErrGeneratorUnavailable", err)
	}
	if strings.Contains(err.Error(), "dashscope-key") {
		t.Fatalf("error leaked the API key: %v", err)
	}
}

type timelineRecordingGenerator struct {
	content []byte
}

func (g *timelineRecordingGenerator) Generate(ctx context.Context, request Request, destination string) error {
	_, err := g.GenerateWithTimeline(ctx, request, destination)
	return err
}

func (g *timelineRecordingGenerator) GenerateWithTimeline(ctx context.Context, request Request, destination string) (Timeline, error) {
	if err := os.WriteFile(destination, g.content, 0o600); err != nil {
		return Timeline{}, err
	}
	return Timeline{Segments: []Segment{{Start: 0, End: 800, Text: request.Term}}}, nil
}

func TestServicePersistsTimelineSidecar(t *testing.T) {
	cacheDir := t.TempDir()
	generator := &timelineRecordingGenerator{content: []byte("audio-data")}
	service, err := NewService(cacheDir, WithGenerator(generator))
	if err != nil {
		t.Fatalf("create service: %v", err)
	}
	request := Request{Term: "abandon", Provider: "dashscope", Format: "wav"}
	if _, err := service.Resolve(context.Background(), request); err != nil {
		t.Fatalf("resolve: %v", err)
	}
	timeline, err := service.Timeline(context.Background(), request)
	if err != nil {
		t.Fatalf("read timeline: %v", err)
	}
	if len(timeline.Segments) != 1 || timeline.Segments[0].Text != "abandon" || timeline.Segments[0].End != 800 {
		t.Fatalf("timeline = %#v", timeline.Segments)
	}
	sidecar := filepath.Join(cacheDir, CacheKey(request)+".wav.timeline.json")
	if _, err := os.Stat(sidecar); err != nil {
		t.Fatalf("sidecar file missing: %v", err)
	}
}

func decodeJSONBody(request *http.Request, target any) error {
	defer request.Body.Close()
	return json.NewDecoder(request.Body).Decode(target)
}
