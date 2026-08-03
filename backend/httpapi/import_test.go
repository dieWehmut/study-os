package httpapi_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"study-os/backend/app"
	"study-os/backend/httpapi"
	"study-os/backend/models"
)

func TestImportUploadPreviewCommitAndKnowledge(t *testing.T) {
	application, err := app.New(context.Background(), app.Options{DataDir: t.TempDir()})
	if err != nil {
		t.Fatalf("construct application: %v", err)
	}
	t.Cleanup(func() { _ = application.Close() })
	router := httpapi.NewRouter(application)

	upload := multipartRequest(t, router, "term,definition\nabandon,放弃\nbank,银行\n", "words.csv")
	if upload.Code != http.StatusCreated {
		t.Fatalf("upload status = %d, body = %s", upload.Code, upload.Body.String())
	}
	var uploaded struct {
		JobID      string `json:"job_id"`
		Inspection struct {
			RowCount int `json:"row_count"`
		} `json:"inspection"`
	}
	decodeJSON(t, upload, &uploaded)
	if uploaded.JobID == "" || uploaded.Inspection.RowCount != 2 {
		t.Fatalf("upload = %#v", uploaded)
	}

	preview := requestJSON(t, router, http.MethodPost, "/api/imports/"+uploaded.JobID+"/preview", map[string]any{
		"mapping": map[string]string{"term": "term", "definition": "definition"},
	})
	if preview.Code != http.StatusOK {
		t.Fatalf("preview status = %d, body = %s", preview.Code, preview.Body.String())
	}
	var previewBody struct {
		Rows []struct {
			ID          string `json:"row_id"`
			Disposition string `json:"disposition"`
		} `json:"rows"`
	}
	decodeJSON(t, preview, &previewBody)
	if len(previewBody.Rows) != 2 || previewBody.Rows[0].ID == "" || previewBody.Rows[0].Disposition != "insert" {
		t.Fatalf("preview rows = %#v", previewBody.Rows)
	}

	commit := requestJSON(t, router, http.MethodPost, "/api/imports/"+uploaded.JobID+"/commit", map[string]any{})
	if commit.Code != http.StatusOK {
		t.Fatalf("commit status = %d, body = %s", commit.Code, commit.Body.String())
	}
	var commitBody struct {
		Summary struct {
			Inserted       int `json:"inserted"`
			PromptsCreated int `json:"prompts_created"`
		} `json:"summary"`
	}
	decodeJSON(t, commit, &commitBody)
	if commitBody.Summary.Inserted != 2 || commitBody.Summary.PromptsCreated != 8 {
		t.Fatalf("commit summary = %#v", commitBody.Summary)
	}

	knowledge := requestJSON(t, router, http.MethodGet, "/api/knowledge?q=abandon&limit=10", nil)
	if knowledge.Code != http.StatusOK {
		t.Fatalf("knowledge status = %d, body = %s", knowledge.Code, knowledge.Body.String())
	}
	var knowledgeBody struct {
		Items []struct {
			ID                string `json:"id"`
			Term              string `json:"term"`
			ConciseDefinition string `json:"concise_definition"`
		} `json:"items"`
	}
	decodeJSON(t, knowledge, &knowledgeBody)
	if len(knowledgeBody.Items) != 1 || knowledgeBody.Items[0].Term != "abandon" {
		t.Fatalf("knowledge items = %#v", knowledgeBody.Items)
	}

	detail := requestJSON(t, router, http.MethodGet, "/api/knowledge/"+knowledgeBody.Items[0].ID, nil)
	if detail.Code != http.StatusOK {
		t.Fatalf("knowledge detail status = %d, body = %s", detail.Code, detail.Body.String())
	}
}

func TestImportCommitLinksWithinBatchExactDuplicate(t *testing.T) {
	application, err := app.New(context.Background(), app.Options{DataDir: t.TempDir()})
	if err != nil {
		t.Fatalf("construct application: %v", err)
	}
	t.Cleanup(func() { _ = application.Close() })
	router := httpapi.NewRouter(application)
	upload := multipartRequest(t, router, "term,definition\nabandon,放弃\nabandon,放弃\n", "words.csv")
	var uploaded struct {
		JobID string `json:"job_id"`
	}
	decodeJSON(t, upload, &uploaded)
	preview := requestJSON(t, router, http.MethodPost, "/api/imports/"+uploaded.JobID+"/preview", map[string]any{"mapping": map[string]string{"term": "term", "definition": "definition"}})
	if preview.Code != http.StatusOK {
		t.Fatalf("preview status = %d, body = %s", preview.Code, preview.Body.String())
	}
	var previewBody struct {
		Rows []struct {
			ID      string `json:"row_id"`
			MatchID string `json:"matched_knowledge_item_id"`
			Kind    string `json:"disposition"`
		} `json:"rows"`
	}
	decodeJSON(t, preview, &previewBody)
	if len(previewBody.Rows) != 2 || previewBody.Rows[1].Kind != "exact_duplicate" || previewBody.Rows[1].MatchID == "" {
		t.Fatalf("preview duplicate rows = %#v", previewBody.Rows)
	}
	commit := requestJSON(t, router, http.MethodPost, "/api/imports/"+uploaded.JobID+"/commit", map[string]any{})
	var commitBody struct {
		Summary struct {
			Inserted int `json:"inserted"`
			Exact    int `json:"exact_duplicates"`
		} `json:"summary"`
	}
	decodeJSON(t, commit, &commitBody)
	if commitBody.Summary.Inserted != 1 || commitBody.Summary.Exact != 1 {
		t.Fatalf("commit duplicate summary = %#v", commitBody.Summary)
	}
	var knowledgeCount int
	if err := application.Store.SQL().QueryRow(`SELECT COUNT(*) FROM knowledge_items`).Scan(&knowledgeCount); err != nil {
		t.Fatalf("count knowledge: %v", err)
	}
	if knowledgeCount != 1 {
		t.Fatalf("knowledge count = %d, want 1", knowledgeCount)
	}
	var linkedID string
	if err := application.Store.SQL().QueryRow(`SELECT COALESCE(linked_knowledge_item_id, '') FROM import_rows WHERE id = ?`, previewBody.Rows[1].ID).Scan(&linkedID); err != nil {
		t.Fatalf("read duplicate import link: %v", err)
	}
	if linkedID != previewBody.Rows[1].MatchID {
		t.Fatalf("duplicate link = %q, want %q", linkedID, previewBody.Rows[1].MatchID)
	}
}

func TestImportCommitMergeResolutionDoesNotInsertNewKnowledge(t *testing.T) {
	application, err := app.New(context.Background(), app.Options{DataDir: t.TempDir()})
	if err != nil {
		t.Fatalf("construct application: %v", err)
	}
	t.Cleanup(func() { _ = application.Close() })
	if err := application.Store.CreateKnowledgeItem(context.Background(), models.KnowledgeItem{ID: "existing", ItemType: "word_sense", Term: "abandon", ConciseDefinition: "放弃;抛弃"}); err != nil {
		t.Fatalf("seed existing knowledge: %v", err)
	}
	router := httpapi.NewRouter(application)
	upload := multipartRequest(t, router, "term,definition\nabandon,放弃;舍弃\n", "words.csv")
	var uploaded struct {
		JobID string `json:"job_id"`
	}
	decodeJSON(t, upload, &uploaded)
	preview := requestJSON(t, router, http.MethodPost, "/api/imports/"+uploaded.JobID+"/preview", map[string]any{"mapping": map[string]string{"term": "term", "definition": "definition"}})
	if preview.Code != http.StatusOK {
		t.Fatalf("preview status = %d, body = %s", preview.Code, preview.Body.String())
	}
	var previewBody struct {
		Rows []struct {
			ID   string `json:"row_id"`
			Kind string `json:"disposition"`
		} `json:"rows"`
	}
	decodeJSON(t, preview, &previewBody)
	if len(previewBody.Rows) != 1 || previewBody.Rows[0].Kind != "review" {
		t.Fatalf("preview review row = %#v", previewBody.Rows)
	}
	commit := requestJSON(t, router, http.MethodPost, "/api/imports/"+uploaded.JobID+"/commit", map[string]any{"resolutions": map[string]string{previewBody.Rows[0].ID: "merge"}})
	var commitBody struct {
		Summary struct{ Inserted, Merged int } `json:"summary"`
	}
	decodeJSON(t, commit, &commitBody)
	if commitBody.Summary.Inserted != 0 || commitBody.Summary.Merged != 1 {
		t.Fatalf("merge summary = %#v", commitBody.Summary)
	}
	var knowledgeCount int
	if err := application.Store.SQL().QueryRow(`SELECT COUNT(*) FROM knowledge_items`).Scan(&knowledgeCount); err != nil {
		t.Fatalf("count knowledge: %v", err)
	}
	if knowledgeCount != 1 {
		t.Fatalf("knowledge count after merge = %d, want 1", knowledgeCount)
	}
}

func TestImportCommitRechecksDuplicatesBeyondPreviewPageAndIsIdempotent(t *testing.T) {
	application, err := app.New(context.Background(), app.Options{DataDir: t.TempDir()})
	if err != nil {
		t.Fatalf("construct application: %v", err)
	}
	t.Cleanup(func() { _ = application.Close() })
	ctx := context.Background()
	for index := 0; index < 501; index++ {
		term := fmt.Sprintf("word-%03d", index)
		if index == 500 {
			term = "target"
		}
		if err := application.Store.CreateKnowledgeItem(ctx, models.KnowledgeItem{
			ID: fmt.Sprintf("existing-%03d", index), ItemType: "word_sense", Term: term, ConciseDefinition: "meaning",
		}); err != nil {
			t.Fatalf("seed knowledge %d: %v", index, err)
		}
	}
	router := httpapi.NewRouter(application)
	upload := multipartRequest(t, router, "term,definition\ntarget,meaning\n", "words.csv")
	var uploaded struct {
		JobID string `json:"job_id"`
	}
	decodeJSON(t, upload, &uploaded)
	preview := requestJSON(t, router, http.MethodPost, "/api/imports/"+uploaded.JobID+"/preview", map[string]any{"mapping": map[string]string{"term": "term", "definition": "definition"}})
	if preview.Code != http.StatusOK {
		t.Fatalf("preview status = %d, body = %s", preview.Code, preview.Body.String())
	}
	commit := requestJSON(t, router, http.MethodPost, "/api/imports/"+uploaded.JobID+"/commit", map[string]any{})
	if commit.Code != http.StatusOK {
		t.Fatalf("commit status = %d, body = %s", commit.Code, commit.Body.String())
	}
	var first struct {
		Summary struct {
			Inserted        int `json:"inserted"`
			ExactDuplicates int `json:"exact_duplicates"`
			PromptsCreated  int `json:"prompts_created"`
		} `json:"summary"`
	}
	decodeJSON(t, commit, &first)
	if first.Summary.Inserted != 0 || first.Summary.ExactDuplicates != 1 || first.Summary.PromptsCreated != 0 {
		t.Fatalf("first commit summary = %#v", first.Summary)
	}

	retry := requestJSON(t, router, http.MethodPost, "/api/imports/"+uploaded.JobID+"/commit", map[string]any{})
	if retry.Code != http.StatusOK {
		t.Fatalf("retry status = %d, body = %s", retry.Code, retry.Body.String())
	}
	var second struct {
		Summary struct {
			Inserted        int `json:"inserted"`
			ExactDuplicates int `json:"exact_duplicates"`
			PromptsCreated  int `json:"prompts_created"`
		} `json:"summary"`
	}
	decodeJSON(t, retry, &second)
	if second.Summary != first.Summary {
		t.Fatalf("retry summary = %#v, want %#v", second.Summary, first.Summary)
	}
}

func multipartRequest(t *testing.T, handler http.Handler, content, filename string) *httptest.ResponseRecorder {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", filepath.Base(filename))
	if err != nil {
		t.Fatalf("create multipart file: %v", err)
	}
	if _, err := part.Write([]byte(content)); err != nil {
		t.Fatalf("write multipart file: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close multipart writer: %v", err)
	}
	request := httptest.NewRequest(http.MethodPost, "http://127.0.0.1/api/imports", &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

var _ = json.RawMessage{}
