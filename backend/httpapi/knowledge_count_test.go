package httpapi_test

import (
	"fmt"
	"net/http"
	"testing"

	"study-os/backend/config"
	"study-os/backend/httpapi"
)

// `count` is how many match, not how many fit on the page. Every caller reads it
// that way -- the library page prints it as "N 个知识点" and decides from it
// whether there is a next page -- so with 140 items behind a limit of 100 the
// answer used to be a library that called itself 100.
func TestKnowledgeListCountsWhatMatchesNotWhatFits(t *testing.T) {
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)
	for index := 0; index < 7; index += 1 {
		if response := requestJSON(t, router, http.MethodPost, "/api/dump", map[string]string{
			"text": fmt.Sprintf("第 %d 条", index),
		}); response.Code != http.StatusCreated {
			t.Fatalf("dump %d = %d, body = %s", index, response.Code, response.Body.String())
		}
	}

	var firstPage struct {
		Count int `json:"count"`
		Items []struct {
			ID string `json:"id"`
		} `json:"items"`
	}
	decodeJSON(t, requestJSON(t, router, http.MethodGet, "/api/knowledge?limit=3", nil), &firstPage)
	if len(firstPage.Items) != 3 {
		t.Fatalf("page held %d items, want 3", len(firstPage.Items))
	}
	if firstPage.Count != 7 {
		t.Fatalf("count = %d, want the whole library (7)", firstPage.Count)
	}

	// And the next page is reachable, which is the point of a count that is not
	// just the page size.
	var secondPage struct {
		Items []struct {
			ID string `json:"id"`
		} `json:"items"`
	}
	decodeJSON(t, requestJSON(t, router, http.MethodGet, "/api/knowledge?limit=3&offset=3", nil), &secondPage)
	if len(secondPage.Items) != 3 {
		t.Fatalf("second page held %d items, want 3", len(secondPage.Items))
	}
	if secondPage.Items[0].ID == firstPage.Items[0].ID {
		t.Fatalf("offset went nowhere: both pages start at %s", firstPage.Items[0].ID)
	}

	// The count follows every filter, or it would send a reader looking for a
	// next page that the filter had already excluded.
	var filtered struct {
		Count int `json:"count"`
	}
	decodeJSON(t, requestJSON(t, router, http.MethodGet, "/api/knowledge?limit=3&q=第%206%20条", nil), &filtered)
	if filtered.Count != 1 {
		t.Fatalf("filtered count = %d, want 1", filtered.Count)
	}
}