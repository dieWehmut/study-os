package httpapi

import (
	"errors"
	"net/http"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"

	"study-os/backend/app"
)

const defaultDailyLimit = 20

type systemStatusResponse struct {
	Provider providerStatus `json:"provider"`
	Data     dataStatus     `json:"data"`
	Review   reviewStatus   `json:"review"`
	Backup   backupStatus   `json:"backup"`
	App      appStatus      `json:"app"`
}

type providerStatus struct {
	Name          string `json:"name"`
	Mode          string `json:"mode"`
	Configured    bool   `json:"configured"`
	Available     bool   `json:"available"`
	KeyConfigured bool   `json:"key_configured"`
	Model         string `json:"model,omitempty"`
}

type dataStatus struct {
	Directory    string `json:"directory"`
	DatabasePath string `json:"database_path"`
}

type reviewStatus struct {
	DailyLimit int `json:"daily_limit"`
}

type backupStatus struct {
	Directory     string `json:"directory"`
	Count         int    `json:"count"`
	LastCreatedAt string `json:"last_created_at,omitempty"`
}

type appStatus struct {
	Version  string `json:"version"`
	Platform string `json:"platform"`
}

func handleSystemStatus(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	limit := readDailyLimit(request, application)
	backupCount, err := application.Store.ReconcileBackupRecords(request.Context())
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "read backup status failed"})
		return
	}
	records, err := application.Store.ListBackupRecords(request.Context(), 1)
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "read latest backup failed"})
		return
	}
	status := systemStatusResponse{
		Provider: providerStatusFor(application),
		Data: dataStatus{
			Directory:    application.Config.DataDir,
			DatabasePath: application.Config.DBPath,
		},
		Review: reviewStatus{DailyLimit: limit},
		Backup: backupStatus{
			Directory: filepath.Join(application.Config.DataDir, "backups"),
			Count:     backupCount,
		},
		App: appStatus{
			Version:  "0.1.0-dev",
			Platform: runtime.GOOS + "/" + runtime.GOARCH,
		},
	}
	if len(records) > 0 {
		status.Backup.LastCreatedAt = records[0].CreatedAt.UTC().Format("2006-01-02T15:04:05.999999999Z07:00")
	}
	writeJSON(response, http.StatusOK, status)
}

func providerStatusFor(application *app.App) providerStatus {
	name := strings.ToLower(strings.TrimSpace(application.Config.ActiveProvider))
	if name == "" {
		name = "mock"
	}
	status := providerStatus{Name: name}
	switch name {
	case "mock":
		status.Mode = "offline"
		status.Configured = true
		status.Available = true
	case "deepseek":
		status.Mode = "remote"
		status.KeyConfigured = strings.TrimSpace(application.Config.DeepSeek.APIKey) != ""
		status.Model = strings.TrimSpace(application.Config.DeepSeek.Model)
		_, providerErr := providerFor(application)
		status.Configured = providerErr == nil
		status.Available = status.Configured
	default:
		status.Mode = "unavailable"
	}
	return status
}

func readDailyLimit(request *http.Request, application *app.App) int {
	value, err := application.Store.GetSetting(request.Context(), "daily_limit")
	if err != nil {
		return defaultDailyLimit
	}
	limit, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || limit < 1 || limit > 500 {
		return defaultDailyLimit
	}
	return limit
}

func handleSettingsPatch(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	var input struct {
		DailyLimit int `json:"daily_limit"`
	}
	request.Body = http.MaxBytesReader(response, request.Body, maxImportJSONBytes)
	if err := decodeRequest(request, &input); err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if input.DailyLimit < 1 || input.DailyLimit > 500 {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "daily_limit must be between 1 and 500"})
		return
	}
	if err := application.Store.SetSetting(request.Context(), "daily_limit", strconv.Itoa(input.DailyLimit)); err != nil {
		if errors.Is(err, request.Context().Err()) {
			writeJSON(response, http.StatusRequestTimeout, map[string]string{"error": "request canceled"})
			return
		}
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "save settings failed"})
		return
	}
	writeJSON(response, http.StatusOK, map[string]int{"daily_limit": input.DailyLimit})
}
