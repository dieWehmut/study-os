package httpapi_test

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"study-os/backend/app"
	"study-os/backend/config"
	"study-os/backend/db"
	"study-os/backend/httpapi"
	"study-os/backend/models"
)

func exportRequest(t *testing.T, router http.Handler, query string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(http.MethodGet, "/api/knowledge/export"+query, nil)
	request.Host = "127.0.0.1:8080"
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	return recorder
}

func createVocabularyItem(t *testing.T, application *app.App, item models.KnowledgeItem) {
	t.Helper()
	now := time.Now().UTC()
	item.CreatedAt, item.UpdatedAt = now, now
	if item.ID == "" {
		item.ID = "k-" + item.Term
	}
	if err := application.Store.CreateKnowledgeItem(context.Background(), item); err != nil {
		t.Fatalf("create item: %v", err)
	}
}

// What 导入 can read, 导出 has to write: the same column names, or the file comes
// back with nothing mapped and nothing about it says so.
func TestKnowledgeExportRoundTripsIntoTheImporter(t *testing.T) {
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)
	createVocabularyItem(t, application, models.KnowledgeItem{ItemType: "word_sense", Term: "abandon", ConciseDefinition: "放弃；抛弃", PartOfSpeech: "v.", Subject: "english", Tags: []string{"gaokao", "verb"}})

	exported := exportRequest(t, router, "?format=csv")
	if exported.Code != http.StatusOK {
		t.Fatalf("export = %d, body = %s", exported.Code, exported.Body.String())
	}
	if disposition := exported.Header().Get("Content-Disposition"); !strings.Contains(disposition, "attachment") || !strings.Contains(disposition, ".csv") {
		t.Fatalf("Content-Disposition = %q", disposition)
	}
	rows, err := csv.NewReader(strings.NewReader(exported.Body.String())).ReadAll()
	if err != nil {
		t.Fatalf("csv: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("rows = %d, want a header and one item: %q", len(rows), exported.Body.String())
	}
	// The header is the importer's own vocabulary.
	want := []string{"term", "definition", "item_type", "part_of_speech", "pronunciation", "example", "wiki", "level", "subject", "tags"}
	if strings.Join(rows[0], ",") != strings.Join(want, ",") {
		t.Fatalf("header = %v, want %v", rows[0], want)
	}
	row := map[string]string{}
	for index, column := range rows[0] {
		if index >= len(rows[1]) {
			t.Fatalf("row has %d fields for %d columns: %v", len(rows[1]), len(rows[0]), rows[1])
		}
		row[column] = rows[1][index]
	}
	if row["term"] != "abandon" || row["definition"] != "放弃；抛弃" || row["item_type"] != "word_sense" {
		t.Fatalf("row = %v", row)
	}
	if row["tags"] != "gaokao verb" {
		t.Fatalf("tags = %q, want them space separated for the importer", row["tags"])
	}

	// The same library as JSONL, one object per line, with the same keys.
	lines := exportRequest(t, router, "?format=jsonl")
	if lines.Code != http.StatusOK {
		t.Fatalf("jsonl export = %d", lines.Code)
	}
	decoded := map[string]any{}
	body := strings.TrimSpace(lines.Body.String())
	if err := json.Unmarshal([]byte(body), &decoded); err != nil {
		t.Fatalf("jsonl line: %v (%q)", err, body)
	}
	if decoded["term"] != "abandon" || decoded["concise_definition"] != nil {
		t.Fatalf("jsonl object = %v", decoded)
	}
	if _, ok := decoded["id"]; !ok {
		t.Fatalf("jsonl object has no id: %v", decoded)
	}
}

func TestKnowledgeExportNarrowsWithTheListFilters(t *testing.T) {
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)
	createVocabularyItem(t, application, models.KnowledgeItem{ItemType: "word_sense", Term: "abandon", ConciseDefinition: "放弃", Subject: "english"})
	createVocabularyItem(t, application, models.KnowledgeItem{ItemType: "word_sense", Term: "velocity", ConciseDefinition: "速度", Subject: "physics"})

	physics := exportRequest(t, router, "?format=csv&subject=physics")
	if !strings.Contains(physics.Body.String(), "velocity") || strings.Contains(physics.Body.String(), "abandon") {
		t.Fatalf("subject filter leaked: %s", physics.Body.String())
	}

	// The reader can hear about a typo in the query rather than receiving a file
	// with the wrong name and finding out later.
	badFormat := exportRequest(t, router, "?format=xlsx")
	if badFormat.Code != http.StatusBadRequest || !strings.Contains(badFormat.Body.String(), "csv") {
		t.Fatalf("bad format = %d, body = %s", badFormat.Code, badFormat.Body.String())
	}
	if badScheduled := exportRequest(t, router, "?scheduled=maybe"); badScheduled.Code != http.StatusBadRequest {
		t.Fatalf("bad scheduled = %d", badScheduled.Code)
	}
	if badArchived := exportRequest(t, router, "?archived=maybe"); badArchived.Code != http.StatusBadRequest {
		t.Fatalf("bad archived = %d", badArchived.Code)
	}

	// 归档 widens the list (the reader switched 显示已归档 on), so the file has to widen with
	// it -- an export that ignored the switch would hand back a smaller library than the
	// screen is showing. The single-item read is never filtered by it, which is why the row
	// survives 归档 in the first place.
	if code := requestJSON(t, router, http.MethodPost, "/api/knowledge/k-abandon/archive", nil).Code; code != http.StatusOK {
		t.Fatalf("archive = %d", code)
	}
	hidden := exportRequest(t, router, "?format=csv")
	if strings.Contains(hidden.Body.String(), "abandon") {
		t.Fatalf("archived item leaked into a default export: %s", hidden.Body.String())
	}
	shown := exportRequest(t, router, "?format=csv&archived=yes")
	if !strings.Contains(shown.Body.String(), "abandon") {
		t.Fatalf("?archived=yes did not widen the export: %s", shown.Body.String())
	}

	// 知识分组 narrows the list, so it has to narrow the file: an export taken
	// from inside a group view used to contain the whole library.
	group := models.KnowledgeGroup{
		ID: "group-mechanics", Name: "力学", CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC(),
	}
	if err := application.Store.CreateKnowledgeGroup(context.Background(), group); err != nil {
		t.Fatalf("create group: %v", err)
	}
	if err := application.Store.WithTx(context.Background(), func(tx *db.TxStore) error {
		_, err := tx.LinkKnowledgeItemsToGroup(context.Background(), []string{"k-velocity"}, group.ID)
		return err
	}); err != nil {
		t.Fatalf("link item to group: %v", err)
	}
	inGroup := exportRequest(t, router, "?group=group-mechanics")
	if !strings.Contains(inGroup.Body.String(), "velocity") || strings.Contains(inGroup.Body.String(), "abandon") {
		t.Fatalf("group filter leaked: %s", inGroup.Body.String())
	}
	// And the search box keeps working inside the group: it used to be ignored
	// there, in the list as well as in the file.
	inGroupSearched := exportRequest(t, router, "?group=group-mechanics&q="+url.QueryEscape("velocity"))
	if !strings.Contains(inGroupSearched.Body.String(), "velocity") {
		t.Fatalf("search inside a group dropped the row: %s", inGroupSearched.Body.String())
	}
	inGroupMissed := exportRequest(t, router, "?group=group-mechanics&q="+url.QueryEscape("abandon"))
	if strings.Contains(inGroupMissed.Body.String(), "velocity") {
		t.Fatalf("search inside a group was ignored: %s", inGroupMissed.Body.String())
	}
}
