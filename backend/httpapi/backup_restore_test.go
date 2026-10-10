package httpapi_test

import (
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"study-os/backend/config"
	"study-os/backend/httpapi"
	"study-os/backend/models"
)

func backupRestore(t *testing.T, router http.Handler, id string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, "/api/backups/"+id+"/restore", nil)
	request.Host = "127.0.0.1:8080"
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	return recorder
}

// The request is recorded, not carried out: the store is open, and swapping it
// under the handlers is a data race. The answer has to say which of the two it is.
func TestBackupRestoreRequestIsRecordedNotExecuted(t *testing.T) {
	dataDir := t.TempDir()
	application := testApplication(t, config.Config{DataDir: dataDir})
	router := httpapi.NewRouter(application)

	if err := application.Store.CreateKnowledgeItem(t.Context(), models.KnowledgeItem{
		ID: "k-1", ItemType: "word_sense", Term: "abandon", ConciseDefinition: "放弃",
	}); err != nil {
		t.Fatalf("create item: %v", err)
	}
	created := requestJSON(t, router, http.MethodPost, "/api/backups", map[string]any{"category": "daily"})
	var body struct {
		ID string `json:"id"`
	}
	decodeJSON(t, created, &body)

	requested := backupRestore(t, router, body.ID)
	if requested.Code != http.StatusAccepted {
		t.Fatalf("restore request = %d, body = %s", requested.Code, requested.Body.String())
	}
	if !strings.Contains(requested.Body.String(), "下次启动") {
		t.Fatalf("restore request body = %s, want it to say when", requested.Body.String())
	}
	// Nothing has changed yet: the row is still there.
	if _, err := os.Stat(dataDir + string(os.PathSeparator) + "restore-request.json"); err != nil {
		t.Fatalf("restore request file: %v", err)
	}
}

func TestBackupRestoreRequestRefusesABackupThatCannotWork(t *testing.T) {
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

	// A truncated copy: it would be refused at the next start anyway, so it is
	// refused here -- while someone is watching and can choose another file.
	if err := os.WriteFile(body.Result.Path, []byte("SQLite format 3\x00truncated"), 0o600); err != nil {
		t.Fatalf("truncate backup: %v", err)
	}
	refused := backupRestore(t, router, body.ID)
	if refused.Code != http.StatusBadRequest || !strings.Contains(refused.Body.String(), "不能用来恢复") {
		t.Fatalf("broken backup = %d, body = %s", refused.Code, refused.Body.String())
	}
	if _, err := os.Stat(dataDir + string(os.PathSeparator) + "restore-request.json"); !os.IsNotExist(err) {
		t.Fatalf("a refused backup still left a request behind: %v", err)
	}
}
