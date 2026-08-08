package httpapi_test

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"study-os/backend/app"
	"study-os/backend/config"
	"study-os/backend/httpapi"
)

func newSpeechApplication(t *testing.T) (*app.App, http.Handler) {
	t.Helper()
	dataDir := t.TempDir()
	envPath := filepath.Join(dataDir, ".env.local")
	if err := os.WriteFile(envPath, []byte("AI_ACTIVE_PROVIDER=mock\n"), 0o600); err != nil {
		t.Fatalf("write env file: %v", err)
	}
	application, err := app.New(context.Background(), app.Options{Config: config.Config{
		ListenAddress:  "127.0.0.1:8080",
		DataDir:        dataDir,
		DBPath:         filepath.Join(dataDir, "study.db"),
		ActiveProvider: "mock",
		EnvFilePath:    envPath,
	}})
	if err != nil {
		t.Fatalf("construct application: %v", err)
	}
	t.Cleanup(func() { _ = application.Close() })
	return application, httpapi.NewRouter(application)
}

func speechJSON(t *testing.T, router http.Handler, method, path, body string) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	var reader *strings.Reader
	if body == "" {
		reader = strings.NewReader("")
	} else {
		reader = strings.NewReader(body)
	}
	request := httptest.NewRequest(method, "http://127.0.0.1"+path, reader)
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	decoded := make(map[string]any)
	if response.Body.Len() > 0 {
		_ = json.Unmarshal(response.Body.Bytes(), &decoded)
	}
	return response, decoded
}

func TestSpeechSettingsExposePresetsWithoutLeakingTheKey(t *testing.T) {
	_, router := newSpeechApplication(t)

	response, payload := speechJSON(t, router, http.MethodPatch, "/api/speech/config",
		`{"provider":"openai","base_url":"https://api.openai.com/v1","api_key":"sk-live-secret","model":"tts-1","voice":"alloy"}`)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if strings.Contains(response.Body.String(), "sk-live-secret") {
		t.Fatalf("the API echoed the speech key back: %s", response.Body.String())
	}
	speech, _ := payload["speech"].(map[string]any)
	if speech["key_configured"] != true || speech["configured"] != true {
		t.Fatalf("speech status = %#v", speech)
	}

	response, payload = speechJSON(t, router, http.MethodGet, "/api/speech", "")
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if strings.Contains(response.Body.String(), "sk-live-secret") {
		t.Fatalf("settings leaked the speech key: %s", response.Body.String())
	}
	speech, _ = payload["speech"].(map[string]any)
	providers, _ := speech["providers"].([]any)
	// The picker has to offer every OpenAI-style vendor the settings copy promises.
	seen := make(map[string]bool, len(providers))
	for _, entry := range providers {
		if spec, ok := entry.(map[string]any); ok {
			seen[spec["id"].(string)] = true
		}
	}
	for _, want := range []string{"openai", "openrouter", "groq", "siliconflow", "azure_openai", "local", "custom"} {
		if !seen[want] {
			t.Fatalf("preset %q is missing from %#v", want, seen)
		}
	}
}

func TestSpeechConfigRejectsAnUnknownProvider(t *testing.T) {
	_, router := newSpeechApplication(t)
	response, _ := speechJSON(t, router, http.MethodPatch, "/api/speech/config", `{"provider":"elevenlabs"}`)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
}

func TestVoiceRoleLifecycle(t *testing.T) {
	_, router := newSpeechApplication(t)

	response, created := speechJSON(t, router, http.MethodPost, "/api/speech/roles",
		`{"name":"强尼·银手","bio":"夜之城的摇滚男孩","provider":"local","base_url":"http://127.0.0.1:8100/v1","model":"indextts-2","voice":"johnny","sort_order":0}`)
	if response.Code != http.StatusCreated {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	roleID, _ := created["id"].(string)
	if roleID == "" {
		t.Fatalf("created role has no id: %#v", created)
	}
	if created["name"] != "强尼·银手" || created["voice"] != "johnny" {
		t.Fatalf("created role = %#v", created)
	}

	response, listed := speechJSON(t, router, http.MethodGet, "/api/speech/roles", "")
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if count, _ := listed["count"].(float64); count != 1 {
		t.Fatalf("count = %#v", listed["count"])
	}

	response, updated := speechJSON(t, router, http.MethodPatch, "/api/speech/roles/"+roleID, `{"bio":"醒醒，武士"}`)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if updated["bio"] != "醒醒，武士" {
		t.Fatalf("bio was not updated: %#v", updated)
	}
	// A partial update must not blank the fields it did not mention.
	if updated["voice"] != "johnny" || updated["name"] != "强尼·银手" {
		t.Fatalf("a partial update clobbered other fields: %#v", updated)
	}

	request := httptest.NewRequest(http.MethodDelete, "http://127.0.0.1/api/speech/roles/"+roleID, nil)
	response = httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusNoContent {
		t.Fatalf("delete status = %d, body = %s", response.Code, response.Body.String())
	}
}

// "active" is a literal path segment sharing its shape with the {roleID} route.
// If chi matched it as an id instead, switching roles would 404 forever.
func TestActiveVoiceRouteIsNotShadowedByTheRoleIDRoute(t *testing.T) {
	_, router := newSpeechApplication(t)
	response, created := speechJSON(t, router, http.MethodPost, "/api/speech/roles", `{"name":"Johnny"}`)
	if response.Code != http.StatusCreated {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	roleID, _ := created["id"].(string)

	response, activated := speechJSON(t, router, http.MethodPatch, "/api/speech/roles/active",
		`{"role_id":"`+roleID+`"}`)
	if response.Code != http.StatusOK {
		t.Fatalf("activate status = %d, body = %s", response.Code, response.Body.String())
	}
	if activated["active_role_id"] != roleID {
		t.Fatalf("active_role_id = %#v, want %q", activated["active_role_id"], roleID)
	}

	_, settings := speechJSON(t, router, http.MethodGet, "/api/speech", "")
	if settings["active_role_id"] != roleID {
		t.Fatalf("settings active_role_id = %#v", settings["active_role_id"])
	}
}

func TestActivatingAnUnknownVoiceRoleIsRejected(t *testing.T) {
	_, router := newSpeechApplication(t)
	response, _ := speechJSON(t, router, http.MethodPatch, "/api/speech/roles/active", `{"role_id":"voice-does-not-exist"}`)
	if response.Code != http.StatusNotFound {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
}

// Deleting the active role must clear the pointer; a dangling id would silently
// send every later playback back to the global voice with no way to notice.
func TestDeletingTheActiveVoiceRoleClearsTheSelection(t *testing.T) {
	_, router := newSpeechApplication(t)
	_, created := speechJSON(t, router, http.MethodPost, "/api/speech/roles", `{"name":"Johnny"}`)
	roleID, _ := created["id"].(string)
	speechJSON(t, router, http.MethodPatch, "/api/speech/roles/active", `{"role_id":"`+roleID+`"}`)

	request := httptest.NewRequest(http.MethodDelete, "http://127.0.0.1/api/speech/roles/"+roleID, nil)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusNoContent {
		t.Fatalf("delete status = %d", response.Code)
	}

	_, settings := speechJSON(t, router, http.MethodGet, "/api/speech", "")
	if settings["active_role_id"] != "" {
		t.Fatalf("active_role_id = %#v, want empty", settings["active_role_id"])
	}
}

func TestVoiceRoleAvatarRoundTrip(t *testing.T) {
	_, router := newSpeechApplication(t)
	_, created := speechJSON(t, router, http.MethodPost, "/api/speech/roles", `{"name":"Johnny"}`)
	roleID, _ := created["id"].(string)

	// A one-pixel PNG is enough to prove the bytes survive the round trip.
	pixel := []byte{
		0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
		'I', 'H', 'D', 'R', 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
	}
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	part, err := writer.CreateFormFile("file", "johnny.png")
	if err != nil {
		t.Fatalf("create form file: %v", err)
	}
	if _, err := part.Write(pixel); err != nil {
		t.Fatalf("write avatar: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close writer: %v", err)
	}
	request := httptest.NewRequest(http.MethodPost, "http://127.0.0.1/api/speech/roles/"+roleID+"/avatar", body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("upload status = %d, body = %s", response.Code, response.Body.String())
	}

	request = httptest.NewRequest(http.MethodGet, "http://127.0.0.1/api/speech/roles/"+roleID+"/avatar", nil)
	response = httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("avatar status = %d, body = %s", response.Code, response.Body.String())
	}
	if !bytes.Equal(response.Body.Bytes(), pixel) {
		t.Fatalf("avatar bytes differ: %d vs %d", response.Body.Len(), len(pixel))
	}
	if got := response.Header().Get("Content-Type"); got != "image/png" {
		t.Fatalf("content type = %q", got)
	}

	_, listed := speechJSON(t, router, http.MethodGet, "/api/speech/roles", "")
	items, _ := listed["items"].([]any)
	first, _ := items[0].(map[string]any)
	if first["has_avatar"] != true {
		t.Fatalf("has_avatar = %#v", first["has_avatar"])
	}
	// The absolute path on disk must never reach the client.
	if strings.Contains(response.Header().Get("X-Stored-Path"), string(filepath.Separator)) {
		t.Fatal("stored path leaked through a header")
	}
	if strings.Contains(mustJSON(t, listed), "avatar_path") {
		t.Fatalf("stored path leaked in the role payload: %s", mustJSON(t, listed))
	}
}

func TestVoiceRoleAvatarRejectsNonImageUploads(t *testing.T) {
	_, router := newSpeechApplication(t)
	_, created := speechJSON(t, router, http.MethodPost, "/api/speech/roles", `{"name":"Johnny"}`)
	roleID, _ := created["id"].(string)

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	part, _ := writer.CreateFormFile("file", "payload.svg")
	_, _ = part.Write([]byte(`<svg onload="alert(1)"></svg>`))
	_ = writer.Close()

	request := httptest.NewRequest(http.MethodPost, "http://127.0.0.1/api/speech/roles/"+roleID+"/avatar", body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
}

func mustJSON(t *testing.T, value any) string {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("encode json: %v", err)
	}
	return string(encoded)
}
