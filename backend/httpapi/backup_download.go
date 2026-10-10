package httpapi

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/go-chi/chi/v5"

	"study-os/backend/app"
)

// handleBackupDownload hands over one backup file.
//
// The backups existed but could not leave the machine: the 设置 page listed a
// path, and on the desktop that path is inside an app directory nobody browses.
// A backup you cannot take anywhere is not a backup yet.
//
// Identified by record id, never by path: the path comes from the database, which
// only ever writes it from RecordBackup. The containment check below is the
// second lock -- a record from an older version, or a hand-edited table, must
// still not be able to name a file outside the backups directory.
func handleBackupDownload(response http.ResponseWriter, request *http.Request, application *app.App) {
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
	file, err := os.Open(path)
	if err != nil {
		// Retention may have removed the file after its record was written; the
		// list call reconciles that, but this one can still arrive first.
		writeJSON(response, http.StatusNotFound, map[string]string{"error": "备份文件已经不在了，列表会在下次刷新时更新"})
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "读取备份失败"})
		return
	}

	name := strings.TrimSpace(filepath.Base(path))
	if name == "" {
		name = "study-os-backup.db"
	}
	response.Header().Set("Content-Type", "application/vnd.sqlite3")
	response.Header().Set("Content-Disposition", `attachment; filename="`+name+`"`)
	// ServeContent rather than io.Copy: it answers Range requests and sends the
	// length, so a reader on a slow link can resume a 40 MB download.
	http.ServeContent(response, request, name, record.CreatedAt, file)
}
