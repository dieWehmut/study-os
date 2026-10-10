package httpapi

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/go-chi/chi/v5"

	"study-os/backend/app"
	"study-os/backend/backup"
)

// handleBackupRestoreRequest records that a backup should be restored at the next
// start. It does not restore anything now, and that is the whole design:
//
//   - the store is open, `application.Store` is read by every handler, and
//     swapping it under them is a data race;
//   - replacing the database file under an open connection is worse than that.
//
// The one moment nobody holds the database is before it is opened, so the request
// is written down and carried out there (app.applyPendingRestore). The answer says
// so plainly rather than implying the data has already changed.
func handleBackupRestoreRequest(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	record, err := application.Store.GetBackupRecord(request.Context(), chi.URLParam(request, "backupID"))
	if err != nil {
		writeStoreError(response, err)
		return
	}
	root, err := filepath.Abs(filepath.Join(application.Config.DataDir, "backups"))
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "resolve backup directory failed"})
		return
	}
	path, err := filepath.Abs(record.Path)
	if err != nil || path != root && !strings.HasPrefix(path, root+string(os.PathSeparator)) {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "这个备份不在备份目录里"})
		return
	}
	if _, err := os.Stat(path); err != nil {
		writeJSON(response, http.StatusNotFound, map[string]string{"error": "备份文件已经不在了，列表会在下次刷新时更新"})
		return
	}
	// Verified before it is promised: the next start would refuse it anyway, and a
	// request that was never going to work should be refused here, while someone
	// is watching.
	if err := backup.VerifySQLite(path); err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{
			"error": "这份备份不能用来恢复（" + strings.TrimSpace(err.Error()) + "）",
		})
		return
	}
	if err := backup.WriteRestoreRequest(application.Config.DataDir, path); err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "记录恢复请求失败"})
		return
	}
	writeJSON(response, http.StatusAccepted, map[string]any{
		"status":  "scheduled",
		"message": "已记下这份备份：下次启动学习系统时用它替换当前数据。",
	})
}
