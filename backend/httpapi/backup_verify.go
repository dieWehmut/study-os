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

// handleBackupVerify answers the one question worth asking before trusting a
// backup: is this file a database at all?
//
// The restore itself (backup.Restore) already verifies before it swaps anything,
// so this does not make restoring safer -- it makes the *decision* possible. A
// reader choosing between five dated files has no way to tell a good one from a
// truncated copy, and finding out during a restore is the worst moment.
//
// Read-only by construction: the file is opened inside backup.VerifySQLite and
// only its integrity is read.
func handleBackupVerify(response http.ResponseWriter, request *http.Request, application *app.App) {
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
	info, err := os.Stat(path)
	if err != nil {
		writeJSON(response, http.StatusNotFound, map[string]string{"error": "备份文件已经不在了，列表会在下次刷新时更新"})
		return
	}
	if err := backup.VerifySQLite(path); err != nil {
		// The reader gets a sentence; the verification detail goes in brackets,
		// since it is the only thing that says *how* the file is broken.
		writeJSON(response, http.StatusBadRequest, map[string]string{
			"error": "这份备份不能用来恢复（" + strings.TrimSpace(err.Error()) + "）",
		})
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{
		"ok":         true,
		"size_bytes": info.Size(),
		"category":   record.Category,
		"created_at": record.CreatedAt,
	})
}
