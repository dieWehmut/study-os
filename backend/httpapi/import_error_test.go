package httpapi_test

import (
	"bytes"
	"database/sql"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	_ "modernc.org/sqlite"

	"study-os/backend/config"
	"study-os/backend/httpapi"
)

func uploadFile(t *testing.T, router http.Handler, name string, content []byte) *httptest.ResponseRecorder {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", name)
	if err != nil {
		t.Fatalf("create form file: %v", err)
	}
	if _, err := part.Write(content); err != nil {
		t.Fatalf("write form file: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close multipart writer: %v", err)
	}
	request := httptest.NewRequest(http.MethodPost, "/api/imports", &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	// The router answers a non-loopback host with 421 before it reads the body.
	request.Host = "127.0.0.1:8080"
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	return recorder
}

// A file the reader chose that the server will not take: the answer has to be
// 400 with a message that says what would work, not a generic 500. The
// classification behind that is a text match, so this is also what keeps a
// reworded message from quietly losing its 400.
func TestImportRejectionsExplainThemselves(t *testing.T) {
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)

	unsupported := uploadFile(t, router, "notes.txt", []byte("term,definition\nrace,condition\n"))
	if unsupported.Code != http.StatusBadRequest {
		t.Fatalf("txt upload = %d, body = %s", unsupported.Code, unsupported.Body.String())
	}
	for _, want := range []string{".txt", "CSV", "JSONL", "SQLite"} {
		if !strings.Contains(unsupported.Body.String(), want) {
			t.Fatalf("txt upload body %q does not mention %q", unsupported.Body.String(), want)
		}
	}

	// A SQLite file with no tables: valid to open, nothing to import. Measured,
	// this is also what a live database looks like when only its main file is
	// copied -- the rows are still in the -wal beside it.
	emptyPath := filepath.Join(t.TempDir(), "empty.sqlite")
	database, err := sql.Open("sqlite", emptyPath)
	if err != nil {
		t.Fatalf("create empty sqlite: %v", err)
	}
	// sql.Open is lazy: without a statement the file is never created.
	if _, err := database.Exec("PRAGMA user_version = 0"); err != nil {
		t.Fatalf("touch empty sqlite: %v", err)
	}
	if err := database.Close(); err != nil {
		t.Fatalf("close empty sqlite: %v", err)
	}
	contents, err := os.ReadFile(emptyPath)
	if err != nil {
		t.Fatalf("read empty sqlite: %v", err)
	}
	empty := uploadFile(t, router, "empty.sqlite", contents)
	if empty.Code != http.StatusBadRequest {
		t.Fatalf("empty sqlite upload = %d, body = %s", empty.Code, empty.Body.String())
	}
	if !strings.Contains(empty.Body.String(), "没有可导入的表") {
		t.Fatalf("empty sqlite upload body = %s", empty.Body.String())
	}

	// The job's state is a different kind of refusal: 409, and the message says
	// which step is missing.
	uploaded := uploadFile(t, router, "words.csv", []byte("term,definition\nrace,condition\n"))
	if uploaded.Code != http.StatusCreated {
		t.Fatalf("csv upload = %d, body = %s", uploaded.Code, uploaded.Body.String())
	}
	var job struct {
		JobID string `json:"job_id"`
	}
	decodeJSON(t, uploaded, &job)
	commit := requestJSON(t, router, http.MethodPost, "/api/imports/"+job.JobID+"/commit", map[string]any{})
	if commit.Code != http.StatusConflict {
		t.Fatalf("commit before preview = %d, body = %s", commit.Code, commit.Body.String())
	}
	if !strings.Contains(commit.Body.String(), "previewed") {
		t.Fatalf("commit before preview body = %s", commit.Body.String())
	}

	// A job that does not exist is a 404, not a 400 and not a 500.
	missing := requestJSON(t, router, http.MethodPost, "/api/imports/nope/preview",
		map[string]any{"mapping": map[string]string{"term": "term", "definition": "definition"}})
	if missing.Code != http.StatusNotFound {
		t.Fatalf("unknown job preview = %d, body = %s", missing.Code, missing.Body.String())
	}
}
