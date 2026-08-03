package httpapi

import (
	"net/http"

	"study-os/backend/app"
	"study-os/backend/launcher"
	"study-os/backend/version"
)

func handleLauncherClose(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Launcher == nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "启动器模式未启用"})
		return
	}
	application.Launcher.Close()
	writeJSON(response, http.StatusOK, map[string]string{"status": "closing"})
}

func handleUpdateStatus(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Launcher == nil {
		writeJSON(response, http.StatusOK, launcher.Status{
			CurrentVersion:  version.Version,
			UpdateAvailable: false,
			Error:           "启动器模式未启用",
		})
		return
	}
	writeJSON(response, http.StatusOK, application.Launcher.Status(request.Context()))
}

func handleUpdateApply(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Launcher == nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "启动器模式未启用"})
		return
	}
	status, err := application.Launcher.Apply(request.Context())
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	application.Launcher.Restart()
	writeJSON(response, http.StatusOK, map[string]any{
		"status":  "updating",
		"version": status.LatestVersion,
	})
}
