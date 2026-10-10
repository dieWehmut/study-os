package httpapi_test

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"study-os/backend/config"
	"study-os/backend/httpapi"
)

// postMultipart sends one file field, whatever its size.
func postMultipart(t *testing.T, router http.Handler, path, name string, content []byte) *httptest.ResponseRecorder {
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
	request := httptest.NewRequest(http.MethodPost, path, &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	request.Host = "127.0.0.1:8080"
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	return recorder
}

// A file over the limit is cut by the body reader before any size check runs, so
// the answer used to be "无效的文件上传" -- true, and useless. The rule that was
// broken is what the reader needs to hear.
func TestOversizedUploadsNameTheLimit(t *testing.T) {
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)
	oversized := bytes.Repeat([]byte("x"), 7<<20)

	attachment := postMultipart(t, router, "/api/chat/attachments", "huge.zip", oversized)
	if attachment.Code != http.StatusBadRequest {
		t.Fatalf("oversized attachment = %d, body = %s", attachment.Code, attachment.Body.String())
	}
	if !strings.Contains(attachment.Body.String(), "5MB") {
		t.Fatalf("oversized attachment body = %s, want the size rule", attachment.Body.String())
	}

	imported := postMultipart(t, router, "/api/imports", "huge.csv", bytes.Repeat([]byte("y"), 27<<20))
	if imported.Code != http.StatusBadRequest {
		t.Fatalf("oversized import = %d, body = %s", imported.Code, imported.Body.String())
	}
	if !strings.Contains(imported.Body.String(), "25 MiB") {
		t.Fatalf("oversized import body = %s, want the size rule", imported.Body.String())
	}
}

// An empty CSV is the reader's mistake too: 400 naming what is missing, not the
// generic failure this endpoint answers with for our own errors.
func TestEmptyCSVSaysWhatIsMissing(t *testing.T) {
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)

	empty := postMultipart(t, router, "/api/imports", "empty.csv", nil)
	if empty.Code != http.StatusBadRequest {
		t.Fatalf("empty csv = %d, body = %s", empty.Code, empty.Body.String())
	}
	if !strings.Contains(empty.Body.String(), "表头") {
		t.Fatalf("empty csv body = %s, want the missing header named", empty.Body.String())
	}
}
