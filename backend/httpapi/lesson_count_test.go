package httpapi_test

import (
	"fmt"
	"net/http"
	"testing"

	"study-os/backend/config"
	"study-os/backend/httpapi"
)

// The lessons page prints `count` as "N 门课程", so it has to be the total and
// not the page: a library of 7 behind a limit of 3 used to call itself 3.
func TestLessonListCountsWhatMatchesNotWhatFits(t *testing.T) {
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)
	for index := 0; index < 7; index += 1 {
		if response := requestJSON(t, router, http.MethodPost, "/api/lessons", map[string]string{
			"subject": "physics",
			"title":   fmt.Sprintf("第 %d 课", index),
		}); response.Code != http.StatusCreated {
			t.Fatalf("create lesson %d = %d, body = %s", index, response.Code, response.Body.String())
		}
	}

	var page struct {
		Count int `json:"count"`
		Items []struct {
			ID string `json:"id"`
		} `json:"items"`
	}
	decodeJSON(t, requestJSON(t, router, http.MethodGet, "/api/lessons?limit=3", nil), &page)
	if len(page.Items) != 3 {
		t.Fatalf("page held %d lessons, want 3", len(page.Items))
	}
	if page.Count != 7 {
		t.Fatalf("count = %d, want the whole library (7)", page.Count)
	}

	// The count follows the filter, or it would send a reader looking for a next
	// page the filter had already excluded.
	var filtered struct {
		Count int `json:"count"`
	}
	decodeJSON(t, requestJSON(t, router, http.MethodGet, "/api/lessons?limit=3&q=第%205%20课", nil), &filtered)
	if filtered.Count != 1 {
		t.Fatalf("filtered count = %d, want 1", filtered.Count)
	}
}
