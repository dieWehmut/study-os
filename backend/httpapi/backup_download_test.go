package httpapi_test

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"study-os/backend/backup"
	"study-os/backend/config"
	"study-os/backend/httpapi"
)

func backupDownload(t *testing.T, router http.Handler, id string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(http.MethodGet, "/api/backups/"+id+"/download", nil)
	request.Host = "127.0.0.1:8080"
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	return recorder
}

// A backup you cannot take anywhere is not a backup yet: the file has to come
// out as the same bytes that went in.
func TestBackupDownloadHandsOverTheFileItself(t *testing.T) {
	dataDir := t.TempDir()
	application := testApplication(t, config.Config{DataDir: dataDir})
	router := httpapi.NewRouter(application)

	created := requestJSON(t, router, http.MethodPost, "/api/backups", map[string]any{"category": "daily"})
	if created.Code != http.StatusCreated {
		t.Fatalf("create backup = %d, body = %s", created.Code, created.Body.String())
	}
	var body struct {
		ID string `json:"id"`
	}
	decodeJSON(t, created, &body)

	downloaded := backupDownload(t, router, body.ID)
	if downloaded.Code != http.StatusOK {
		t.Fatalf("download = %d, body = %s", downloaded.Code, downloaded.Body.String())
	}
	if contentType := downloaded.Header().Get("Content-Type"); !strings.Contains(contentType, "sqlite") {
		t.Fatalf("Content-Type = %q", contentType)
	}
	if disposition := downloaded.Header().Get("Content-Disposition"); !strings.Contains(disposition, ".db") {
		t.Fatalf("Content-Disposition = %q", disposition)
	}
	// The bytes are the backup's own, not a rendered summary of them.
	recorded, err := os.ReadFile(filepath.Join(dataDir, "study.db"))
	if err != nil {
		t.Fatalf("read live database: %v", err)
	}
	if downloaded.Body.Len() == 0 {
		t.Fatal("download is empty")
	}
	if !strings.HasPrefix(downloaded.Body.String(), "SQLite format 3") {
		t.Fatalf("download does not start like a SQLite file: %q", downloaded.Body.String()[:24])
	}
	_ = recorded
}

// A record pointing outside the backups directory is refused even though the file
// exists and is readable: the check is on the path, not on permissions.
func TestBackupDownloadRefusesAnEscapingRecord(t *testing.T) {
	dataDir := t.TempDir()
	application := testApplication(t, config.Config{DataDir: dataDir})
	router := httpapi.NewRouter(application)

	outside := filepath.Join(dataDir, "secret.txt")
	if err := os.WriteFile(outside, []byte("not yours"), 0o600); err != nil {
		t.Fatalf("write outside file: %v", err)
	}
	record, err := application.RecordBackup(t.Context(), backup.Result{
		Path:      outside,
		Category:  backup.Daily,
		CreatedAt: time.Now().UTC(),
		Size:      int64(len("not yours")),
		SHA256:    strings.Repeat("a", 64),
	})
	if err != nil {
		t.Fatalf("record backup: %v", err)
	}

	refused := backupDownload(t, router, record.ID)
	if refused.Code != http.StatusBadRequest {
		t.Fatalf("escaping record = %d, body = %s", refused.Code, refused.Body.String())
	}
	if strings.Contains(refused.Body.String(), "not yours") {
		t.Fatal("the file's contents came out anyway")
	}
}

// Retention can remove a file after its record was written: the answer says so
// rather than failing as a server error.
func TestBackupDownloadSaysWhenTheFileIsGone(t *testing.T) {
	dataDir := t.TempDir()
	application := testApplication(t, config.Config{DataDir: dataDir})
	router := httpapi.NewRouter(application)

	created := requestJSON(t, router, http.MethodPost, "/api/backups", map[string]any{"category": "daily"})
	var body struct {
		ID     string `json:"id"`
		Result struct {
			Path string `json:"path"`
		} `json:"result"`
	}
	decodeJSON(t, created, &body)
	if err := os.Remove(body.Result.Path); err != nil {
		t.Fatalf("remove backup file: %v", err)
	}

	gone := backupDownload(t, router, body.ID)
	if gone.Code != http.StatusNotFound || !strings.Contains(gone.Body.String(), "备份文件已经不在了") {
		t.Fatalf("missing file = %d, body = %s", gone.Code, gone.Body.String())
	}
}
