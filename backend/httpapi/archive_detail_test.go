package httpapi_test

import (
	"net/http"
	"testing"

	"study-os/backend/config"
	"study-os/backend/httpapi"
)

// The single-item read answers 归档 state, because a deep link has no list to look in.
//
// The list reports it through `archived_ids`; a `?item=` link or a 词族 link routinely
// selects an item the current page never carried. Without this field the panel offered
// 归档 for something already put away -- a button that says the opposite of the truth.
func TestKnowledgeDetailReportsArchivedState(t *testing.T) {
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)

	dumped := requestJSON(t, router, http.MethodPost, "/api/dump", map[string]any{
		"text": "详情答归档状态 / 单条也要说得清",
	})
	var created struct {
		ID string `json:"id"`
	}
	decodeJSON(t, dumped, &created)
	if created.ID == "" {
		t.Fatalf("dump produced no item: %s", dumped.Body.String())
	}

	read := func() bool {
		response := requestJSON(t, router, http.MethodGet, "/api/knowledge/"+created.ID, nil)
		if response.Code != http.StatusOK {
			t.Fatalf("detail = %d, body = %s", response.Code, response.Body.String())
		}
		var body struct {
			Archived bool `json:"archived"`
		}
		decodeJSON(t, response, &body)
		return body.Archived
	}

	if read() {
		t.Fatalf("a fresh item reports itself as archived")
	}
	if code := requestJSON(t, router, http.MethodPost, "/api/knowledge/"+created.ID+"/archive", nil).Code; code != http.StatusOK {
		t.Fatalf("archive = %d", code)
	}
	if !read() {
		t.Fatalf("the archived item does not report itself as archived")
	}
	// And back: 取消归档 is symmetrical, so the field has to follow in both directions.
	if code := requestJSON(t, router, http.MethodDelete, "/api/knowledge/"+created.ID+"/archive", nil).Code; code != http.StatusOK {
		t.Fatalf("unarchive = %d", code)
	}
	if read() {
		t.Fatalf("the unarchived item still reports itself as archived")
	}
}
