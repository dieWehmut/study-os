package httpapi

import (
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"study-os/backend/app"
	"study-os/backend/config"
	"study-os/backend/models"
)

// maxVoiceAvatarBytes bounds a role avatar. Avatars render at roughly 40px, so
// anything larger is a user mistake rather than a requirement.
const maxVoiceAvatarBytes = 2 << 20

var allowedAvatarExtensions = map[string]string{
	".png":  "image/png",
	".jpg":  "image/jpeg",
	".jpeg": "image/jpeg",
	".gif":  "image/gif",
	".webp": "image/webp",
}

// handleSpeechSettings returns the 语音合成 endpoint configuration together with
// the saved voice roles, so the settings panel renders from a single request.
func handleSpeechSettings(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	roles, err := application.Store.ListVoiceRoles(request.Context())
	if err != nil {
		writeStoreError(response, err)
		return
	}
	activeID, err := application.Store.ActiveVoiceRoleID(request.Context())
	if err != nil {
		writeStoreError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{
		"speech":         application.Config.SpeechStatus(),
		"roles":          roles,
		"active_role_id": activeID,
	})
}

// handleSpeechConfig persists the global endpoint to the local env file. The API
// key is written but never echoed back, matching how chat vendor keys behave.
func handleSpeechConfig(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	var input struct {
		Provider *string `json:"provider"`
		BaseURL  *string `json:"base_url"`
		APIKey   *string `json:"api_key"`
		Model    *string `json:"model"`
		Voice    *string `json:"voice"`
		Format   *string `json:"format"`
	}
	request.Body = http.MaxBytesReader(response, request.Body, maxImportJSONBytes)
	if err := decodeRequest(request, &input); err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	updates := make(map[string]string)
	if input.Provider != nil {
		provider := strings.TrimSpace(*input.Provider)
		if provider != "" {
			if _, ok := config.LookupSpeechProvider(provider); !ok {
				writeJSON(response, http.StatusBadRequest, map[string]string{"error": "unsupported speech provider"})
				return
			}
		}
		updates["SPEECH_PROVIDER"] = provider
	}
	if input.BaseURL != nil {
		updates["SPEECH_BASE_URL"] = strings.TrimSpace(*input.BaseURL)
	}
	if input.APIKey != nil {
		updates["SPEECH_API_KEY"] = strings.TrimSpace(*input.APIKey)
	}
	if input.Model != nil {
		updates["SPEECH_MODEL"] = strings.TrimSpace(*input.Model)
	}
	if input.Voice != nil {
		updates["SPEECH_VOICE"] = strings.TrimSpace(*input.Voice)
	}
	if input.Format != nil {
		format := strings.ToLower(strings.TrimSpace(*input.Format))
		if format != "" && !isSupportedSpeechFormat(format) {
			writeJSON(response, http.StatusBadRequest, map[string]string{"error": "unsupported audio format"})
			return
		}
		updates["SPEECH_FORMAT"] = format
	}
	if len(updates) == 0 {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "no config fields provided"})
		return
	}
	if err := config.UpdateEnvFile(application.Config.EnvFilePath, updates); err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	// Mirror the write into the live config so synthesis picks it up without a
	// restart, then rebuild the generator around the new endpoint.
	settings := application.Config.SpeechSettings
	if value, ok := updates["SPEECH_PROVIDER"]; ok {
		settings.Provider = value
	}
	if value, ok := updates["SPEECH_BASE_URL"]; ok {
		settings.BaseURL = value
	}
	if value, ok := updates["SPEECH_API_KEY"]; ok {
		settings.APIKey = value
	}
	if value, ok := updates["SPEECH_MODEL"]; ok {
		settings.Model = value
	}
	if value, ok := updates["SPEECH_VOICE"]; ok {
		settings.Voice = value
	}
	if value, ok := updates["SPEECH_FORMAT"]; ok {
		settings.Format = value
	}
	application.Config.SpeechSettings = settings
	application.RebuildAudioGenerator()

	writeJSON(response, http.StatusOK, map[string]any{"speech": application.Config.SpeechStatus()})
}

func handleVoiceRoleList(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	roles, err := application.Store.ListVoiceRoles(request.Context())
	if err != nil {
		writeStoreError(response, err)
		return
	}
	activeID, _ := application.Store.ActiveVoiceRoleID(request.Context())
	writeJSON(response, http.StatusOK, map[string]any{
		"items": roles, "count": len(roles), "active_role_id": activeID,
	})
}

func handleVoiceRoleCreate(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	var input struct {
		Name      string `json:"name"`
		Bio       string `json:"bio"`
		Provider  string `json:"provider"`
		BaseURL   string `json:"base_url"`
		Model     string `json:"model"`
		Voice     string `json:"voice"`
		SortOrder int    `json:"sort_order"`
	}
	request.Body = http.MaxBytesReader(response, request.Body, maxImportJSONBytes)
	if err := decodeRequest(request, &input); err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	name := strings.TrimSpace(input.Name)
	if name == "" {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "角色名称不能为空"})
		return
	}
	now := time.Now().UTC()
	role := models.VoiceRole{
		ID:        newRequestID("voice"),
		Name:      name,
		Bio:       strings.TrimSpace(input.Bio),
		Provider:  strings.TrimSpace(input.Provider),
		BaseURL:   strings.TrimSpace(input.BaseURL),
		Model:     strings.TrimSpace(input.Model),
		Voice:     strings.TrimSpace(input.Voice),
		SortOrder: input.SortOrder,
		CreatedAt: now,
		UpdatedAt: now,
	}
	if err := application.Store.CreateVoiceRole(request.Context(), role); err != nil {
		writeStoreError(response, err)
		return
	}
	writeJSON(response, http.StatusCreated, role)
}

func handleVoiceRoleUpdate(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	roleID := strings.TrimSpace(chi.URLParam(request, "roleID"))
	existing, err := application.Store.GetVoiceRole(request.Context(), roleID)
	if err != nil {
		writeStoreError(response, err)
		return
	}
	var input struct {
		Name      *string `json:"name"`
		Bio       *string `json:"bio"`
		Provider  *string `json:"provider"`
		BaseURL   *string `json:"base_url"`
		Model     *string `json:"model"`
		Voice     *string `json:"voice"`
		SortOrder *int    `json:"sort_order"`
	}
	request.Body = http.MaxBytesReader(response, request.Body, maxImportJSONBytes)
	if err := decodeRequest(request, &input); err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if input.Name != nil {
		name := strings.TrimSpace(*input.Name)
		if name == "" {
			writeJSON(response, http.StatusBadRequest, map[string]string{"error": "角色名称不能为空"})
			return
		}
		existing.Name = name
	}
	if input.Bio != nil {
		existing.Bio = strings.TrimSpace(*input.Bio)
	}
	if input.Provider != nil {
		existing.Provider = strings.TrimSpace(*input.Provider)
	}
	if input.BaseURL != nil {
		existing.BaseURL = strings.TrimSpace(*input.BaseURL)
	}
	if input.Model != nil {
		existing.Model = strings.TrimSpace(*input.Model)
	}
	if input.Voice != nil {
		existing.Voice = strings.TrimSpace(*input.Voice)
	}
	if input.SortOrder != nil {
		existing.SortOrder = *input.SortOrder
	}
	if err := application.Store.UpdateVoiceRole(request.Context(), existing); err != nil {
		writeStoreError(response, err)
		return
	}
	updated, err := application.Store.GetVoiceRole(request.Context(), roleID)
	if err != nil {
		writeStoreError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, updated)
}

func handleVoiceRoleDelete(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	roleID := strings.TrimSpace(chi.URLParam(request, "roleID"))
	existing, err := application.Store.GetVoiceRole(request.Context(), roleID)
	if err != nil {
		writeStoreError(response, err)
		return
	}
	if err := application.Store.DeleteVoiceRole(request.Context(), roleID); err != nil {
		writeStoreError(response, err)
		return
	}
	// The row is gone either way; a leftover avatar is only wasted disk, so a
	// failure here must not turn a successful delete into an error.
	if existing.AvatarPath != "" {
		_ = os.Remove(existing.AvatarPath)
	}
	response.WriteHeader(http.StatusNoContent)
}

func handleVoiceRoleActivate(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	var input struct {
		RoleID string `json:"role_id"`
	}
	request.Body = http.MaxBytesReader(response, request.Body, maxImportJSONBytes)
	if err := decodeRequest(request, &input); err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if err := application.Store.SetActiveVoiceRole(request.Context(), strings.TrimSpace(input.RoleID)); err != nil {
		writeStoreError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{"active_role_id": strings.TrimSpace(input.RoleID)})
}

func handleVoiceRoleAvatarUpload(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	roleID := strings.TrimSpace(chi.URLParam(request, "roleID"))
	existing, err := application.Store.GetVoiceRole(request.Context(), roleID)
	if err != nil {
		writeStoreError(response, err)
		return
	}
	request.Body = http.MaxBytesReader(response, request.Body, maxVoiceAvatarBytes+(1<<20))
	if err := request.ParseMultipartForm(maxVoiceAvatarBytes + (1 << 20)); err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "无效的文件上传"})
		return
	}
	file, header, err := request.FormFile("file")
	if err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "multipart file field is required"})
		return
	}
	defer file.Close()
	extension := strings.ToLower(filepath.Ext(header.Filename))
	if _, ok := allowedAvatarExtensions[extension]; !ok {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "头像仅支持 PNG / JPG / GIF / WebP"})
		return
	}
	if header.Size > maxVoiceAvatarBytes {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "头像不能超过 2MB"})
		return
	}
	directory := filepath.Join(application.Config.DataDir, "uploads", "voice-roles")
	if err := os.MkdirAll(directory, 0o700); err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "创建头像目录失败"})
		return
	}
	destination := filepath.Join(directory, roleID+extension)
	out, err := os.Create(destination)
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "保存头像失败"})
		return
	}
	written, copyErr := io.Copy(out, io.LimitReader(file, maxVoiceAvatarBytes+1))
	_ = out.Close()
	if copyErr != nil || written > maxVoiceAvatarBytes {
		_ = os.Remove(destination)
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "头像不能超过 2MB"})
		return
	}
	if err := application.Store.SetVoiceRoleAvatar(request.Context(), roleID, destination); err != nil {
		_ = os.Remove(destination)
		writeStoreError(response, err)
		return
	}
	// Replacing a PNG with a JPG leaves the old file behind under a different
	// extension, which would keep shadowing disk space forever.
	if existing.AvatarPath != "" && existing.AvatarPath != destination {
		_ = os.Remove(existing.AvatarPath)
	}
	writeJSON(response, http.StatusOK, map[string]any{"id": roleID, "has_avatar": true, "size_bytes": written})
}

func handleVoiceRoleAvatarGet(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	role, err := application.Store.GetVoiceRole(request.Context(), strings.TrimSpace(chi.URLParam(request, "roleID")))
	if err != nil {
		writeStoreError(response, err)
		return
	}
	if strings.TrimSpace(role.AvatarPath) == "" {
		writeJSON(response, http.StatusNotFound, map[string]string{"error": "该角色还没有头像"})
		return
	}
	if contentType, ok := allowedAvatarExtensions[strings.ToLower(filepath.Ext(role.AvatarPath))]; ok {
		response.Header().Set("Content-Type", contentType)
	}
	// The avatar changes in place when re-uploaded, so let the browser revalidate
	// rather than serve a stale face from cache.
	response.Header().Set("Cache-Control", "private, no-cache")
	http.ServeFile(response, request, role.AvatarPath)
}

func isSupportedSpeechFormat(format string) bool {
	switch format {
	case "wav", "mp3", "ogg", "m4a", "aac", "flac":
		return true
	default:
		return false
	}
}
