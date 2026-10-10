package httpapi_test

import (
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"study-os/backend/backup"
	"study-os/backend/config"
	"study-os/backend/httpapi"
)

func backupVerify(t *testing.T, router http.Handler, id string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(http.MethodGet, "/api/backups/"+id+"/verify", nil)
	request.Host = "127.0.0.1:8080"
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	return recorder
}

// Choosing between five dated backups needs an answer short of restoring one:
// finding out a file is truncated during a restore is the worst moment to learn.
func TestBackupVerifyAnswersWhetherAFileIsUsable(t *testing.T) {
	dataDir := t.TempDir()
	application := testApplication(t, config.Config{DataDir: dataDir})
	router := httpapi.NewRouter(application)

	created := requestJSON(t, router, http.MethodPost, "/api/backups", map[string]any{"category": "daily"})
	if created.Code != http.StatusCreated {
		t.Fatalf("create backup = %d, body = %s", created.Code, created.Body.String())
	}
	var body struct {
		ID     string `json:"id"`
		Result struct {
			Path string `json:"path"`
		} `json:"result"`
	}
	decodeJSON(t, created, &body)

	good := backupVerify(t, router, body.ID)
	if good.Code != http.StatusOK {
		t.Fatalf("verify = %d, body = %s", good.Code, good.Body.String())
	}
	if !strings.Contains(good.Body.String(), `"ok":true`) {
		t.Fatalf("verify body = %s", good.Body.String())
	}

	// A truncated copy: the file still exists and is named like a backup, which
	// is exactly the case a listing cannot tell apart from a good one.
	truncated := append([]byte("SQLite format 3\x00"), []byte("not really a database")...)
	if err := os.WriteFile(body.Result.Path, truncated, 0o600); err != nil {
		t.Fatalf("truncate backup: %v", err)
	}
	bad := backupVerify(t, router, body.ID)
	if bad.Code != http.StatusBadRequest {
		t.Fatalf("verify broken = %d, body = %s", bad.Code, bad.Body.String())
	}
	if !strings.Contains(bad.Body.String(), "不能用来恢复") {
		t.Fatalf("verify broken body = %s, want a sentence naming the decision", bad.Body.String())
	}
}

// The same containment rule as the download: a record naming a file outside the
// backups directory is refused even though the file is readable.
func TestBackupVerifyRefusesAnEscapingRecord(t *testing.T) {
	dataDir := t.TempDir()
	application := testApplication(t, config.Config{DataDir: dataDir})
	router := httpapi.NewRouter(application)

	outside := dataDir + string(os.PathSeparator) + "elsewhere.db"
	if err := os.WriteFile(outside, []byte("SQLite format 3\x00"), 0o600); err != nil {
		t.Fatalf("write outside file: %v", err)
	}
	record, err := application.RecordBackup(t.Context(), backup.Result{
		Path:      outside,
		Category:  backup.Daily,
		CreatedAt: time.Now().UTC(),
		Size:      16,
		SHA256:    strings.Repeat("a", 64),
	})
	if err != nil {
		t.Fatalf("record backup: %v", err)
	}

	refused := backupVerify(t, router, record.ID)
	if refused.Code != http.StatusBadRequest || !strings.Contains(refused.Body.String(), "不在备份目录里") {
		t.Fatalf("escaping record = %d, body = %s", refused.Code, refused.Body.String())
	}
}
