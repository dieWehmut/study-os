package httpapi_test

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"study-os/backend/app"
	"study-os/backend/audio"
	"study-os/backend/config"
	"study-os/backend/httpapi"
)

type unavailableAudioGenerator struct{}

func (unavailableAudioGenerator) Generate(context.Context, audio.Request, string) error {
	return audio.ErrGeneratorUnavailable
}

type recordingAudioGenerator struct {
	calls int
}

func (generator *recordingAudioGenerator) Generate(_ context.Context, _ audio.Request, destination string) error {
	generator.calls++
	return os.WriteFile(destination, []byte("generated-audio"), 0o600)
}

func TestAudioEndpointStreamsLocalFileAndSupportsRanges(t *testing.T) {
	dataDir := t.TempDir()
	audioDir := filepath.Join(dataDir, "audio")
	if err := os.MkdirAll(audioDir, 0o700); err != nil {
		t.Fatalf("create audio dir: %v", err)
	}
	content := []byte("0123456789-local-audio")
	if err := os.WriteFile(filepath.Join(audioDir, "abandon.mp3"), content, 0o600); err != nil {
		t.Fatalf("write local audio: %v", err)
	}
	application, err := app.New(context.Background(), app.Options{Config: config.Config{
		ListenAddress: "127.0.0.1:8080",
		DataDir:       dataDir,
		DBPath:        filepath.Join(dataDir, "study.db"),
		AIProvider:    "mock",
	}})
	if err != nil {
		t.Fatalf("construct application: %v", err)
	}
	t.Cleanup(func() { _ = application.Close() })
	router := httpapi.NewRouter(application)

	request := httptest.NewRequest(http.MethodGet, "http://127.0.0.1/api/audio?term=abandon", nil)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if got := response.Header().Get("Content-Type"); got != "audio/mpeg" {
		t.Fatalf("content type = %q", got)
	}
	if string(response.Body.Bytes()) != string(content) {
		t.Fatalf("body = %q", response.Body.String())
	}

	rangeRequest := httptest.NewRequest(http.MethodGet, "http://127.0.0.1/api/audio?term=abandon", nil)
	rangeRequest.Header.Set("Range", "bytes=2-5")
	rangeResponse := httptest.NewRecorder()
	router.ServeHTTP(rangeResponse, rangeRequest)
	if rangeResponse.Code != http.StatusPartialContent {
		t.Fatalf("range status = %d, body = %s", rangeResponse.Code, rangeResponse.Body.String())
	}
	got, err := io.ReadAll(rangeResponse.Body)
	if err != nil {
		t.Fatalf("read range: %v", err)
	}
	if string(got) != "2345" {
		t.Fatalf("range body = %q", string(got))
	}
}

func TestAudioEndpointRejectsEmptyAndUnsafeRequests(t *testing.T) {
	dataDir := t.TempDir()
	application, err := app.New(context.Background(), app.Options{Config: config.Config{
		ListenAddress: "127.0.0.1:8080",
		DataDir:       dataDir,
		DBPath:        filepath.Join(dataDir, "study.db"),
		AIProvider:    "mock",
	}})
	if err != nil {
		t.Fatalf("construct application: %v", err)
	}
	t.Cleanup(func() { _ = application.Close() })
	router := httpapi.NewRouter(application)

	for _, target := range []string{
		"http://127.0.0.1/api/audio",
		"http://127.0.0.1/api/audio?term=safe&local_path=../outside.mp3",
	} {
		request := httptest.NewRequest(http.MethodGet, target, nil)
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		if response.Code != http.StatusBadRequest {
			t.Fatalf("target %q status = %d, body = %s", target, response.Code, response.Body.String())
		}
	}
}

func TestAudioEndpointReportsGeneratorUnavailableAsRetryable(t *testing.T) {
	dataDir := t.TempDir()
	application, err := app.New(context.Background(), app.Options{Config: config.Config{
		ListenAddress: "127.0.0.1:8080",
		DataDir:       dataDir,
		DBPath:        filepath.Join(dataDir, "study.db"),
		AIProvider:    "mock",
	}})
	if err != nil {
		t.Fatalf("construct application: %v", err)
	}
	t.Cleanup(func() { _ = application.Close() })
	application.Audio, err = audio.NewService(filepath.Join(dataDir, "audio-cache-test"), audio.WithGenerator(unavailableAudioGenerator{}))
	if err != nil {
		t.Fatalf("construct unavailable audio service: %v", err)
	}
	request := httptest.NewRequest(http.MethodPost, "http://127.0.0.1/api/audio?term=missing", nil)
	response := httptest.NewRecorder()
	httpapi.NewRouter(application).ServeHTTP(response, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("status = %d, body = %s; want missing generation header rejected", response.Code, response.Body.String())
	}
	request = httptest.NewRequest(http.MethodPost, "http://127.0.0.1/api/audio?term=missing", nil)
	request.Header.Set("X-Study-OS-Request", "1")
	response = httptest.NewRecorder()
	httpapi.NewRouter(application).ServeHTTP(response, request)
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, body = %s; want retryable 503", response.Code, response.Body.String())
	}
}

func TestAudioGetNeverInvokesGenerator(t *testing.T) {
	dataDir := t.TempDir()
	application, err := app.New(context.Background(), app.Options{Config: config.Config{
		ListenAddress: "127.0.0.1:8080",
		DataDir:       dataDir,
		DBPath:        filepath.Join(dataDir, "study.db"),
		AIProvider:    "mock",
	}})
	if err != nil {
		t.Fatalf("construct application: %v", err)
	}
	t.Cleanup(func() { _ = application.Close() })
	generator := &recordingAudioGenerator{}
	application.Audio, err = audio.NewService(filepath.Join(dataDir, "audio-cache-test"), audio.WithGenerator(generator))
	if err != nil {
		t.Fatalf("construct recording audio service: %v", err)
	}
	router := httpapi.NewRouter(application)

	getRequest := httptest.NewRequest(http.MethodGet, "http://127.0.0.1/api/audio?term=missing", nil)
	getResponse := httptest.NewRecorder()
	router.ServeHTTP(getResponse, getRequest)
	if getResponse.Code != http.StatusNotFound || generator.calls != 0 {
		t.Fatalf("GET status = %d, generator calls = %d; want 404 and no side effect", getResponse.Code, generator.calls)
	}

	postRequest := httptest.NewRequest(http.MethodPost, "http://127.0.0.1/api/audio?term=missing", nil)
	postRequest.Header.Set("X-Study-OS-Request", "1")
	postResponse := httptest.NewRecorder()
	router.ServeHTTP(postResponse, postRequest)
	if postResponse.Code != http.StatusOK || generator.calls != 1 {
		t.Fatalf("POST status = %d, generator calls = %d; want generated audio", postResponse.Code, generator.calls)
	}
}
