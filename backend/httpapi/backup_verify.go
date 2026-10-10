package httpapi

import (
	"context"
	"database/sql"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/go-chi/chi/v5"
	_ "modernc.org/sqlite"

	"study-os/backend/app"
	"study-os/backend/backup"
)

// What a reader wants to know about a backup before trusting it: is it usable, and
// is it the one they want? "ok" alone cannot tell yesterday's copy from one three
// months old.
//
// The tables are named here rather than discovered, and no name comes from the
// request: the file is opened read-only and the query text is fixed.
var backupContentTables = []struct {
	table string
	label string
}{
	{"knowledge_items", "知识点"},
	{"lessons", "课程"},
	{"questions", "错题"},
	{"review_states", "复习卡"},
	{"english_articles", "英语时文"},
}

// handleBackupVerify answers the one question worth asking before trusting a
// backup: is this file a database at all, and what is in it?
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
		"contents":   backupContents(request.Context(), path),
	})
}

// backupContents counts the rows a reader recognises. A table that is not in this
// file is left out rather than reported as zero: an older backup predates some of
// them, and "0 门课程" would read as an empty course list rather than as "before
// courses existed".
func backupContents(ctx context.Context, path string) []map[string]any {
	database, err := sql.Open("sqlite", path+"?mode=ro")
	if err != nil {
		return nil
	}
	defer database.Close()
	contents := make([]map[string]any, 0, len(backupContentTables))
	for _, entry := range backupContentTables {
		var total int
		if err := database.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+entry.table).Scan(&total); err != nil {
			continue
		}
		if total == 0 {
			continue
		}
		contents = append(contents, map[string]any{"table": entry.table, "label": entry.label, "count": total})
	}
	return contents
}
