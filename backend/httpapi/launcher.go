package httpapi

import (
	"net/http"

	"study-os/backend/app"
	"study-os/backend/selfupdate"
	"study-os/backend/version"
)

// handleUpdateStatus reports the desktop updater state. The update surface is
// available in every desktop build, so this endpoint no longer depends on
// launcher mode being enabled.
func handleUpdateStatus(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Updater == nil {
		writeJSON(response, http.StatusOK, selfupdate.Status{
			CurrentVersion:  version.Version,
			UpdateAvailable: false,
			Error:           "更新服务未启用",
		})
		return
	}
	writeJSON(response, http.StatusOK, application.Updater.Status(request.Context()))
}

// handleUpdateApply stages the newest release and then asks the app to exit so
// the restart script can replace the running executable.
func handleUpdateApply(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Updater == nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "更新服务未启用"})
		return
	}
	status, err := application.Updater.Apply(request.Context())
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{
		"status":  "updating",
		"version": status.LatestVersion,
	})
}
