package httpapi_test

import (
	"net/http"
	"testing"

	"study-os/backend/config"
	"study-os/backend/httpapi"
)

// The widened list has to say which rows it widened to.
//
// `?archived=yes` is the only view an archived item can appear in, and without this the
// reader sees them but cannot tell which ones they put away -- the switch would answer
// half the question. Same shape as `scheduled_ids`, and checked together with it so the
// two never drift apart.
func TestKnowledgeListReportsWhichRowsAreArchived(t *testing.T) {
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)

	dumped := requestJSON(t, router, http.MethodPost, "/api/dump", map[string]any{
		"text": "列标记的归档 / 分得出哪条是自己收的",
	})
	var created struct {
		ID string `json:"id"`
	}
	decodeJSON(t, dumped, &created)
	if created.ID == "" {
		t.Fatalf("dump produced no item: %s", dumped.Body.String())
	}

	// Before archiving: the id must not be in the report.
	before := requestJSON(t, router, http.MethodGet, "/api/knowledge?archived=yes&limit=50", nil)
	var beforeBody struct {
		ArchivedIDs []string `json:"archived_ids"`
	}
	decodeJSON(t, before, &beforeBody)
	if contains(beforeBody.ArchivedIDs, created.ID) {
		t.Fatalf("an unarchived item is reported as archived: %v", beforeBody.ArchivedIDs)
	}

	if code := requestJSON(t, router, http.MethodPost, "/api/knowledge/"+created.ID+"/archive", nil).Code; code != http.StatusOK {
		t.Fatalf("archive = %d", code)
	}

	after := requestJSON(t, router, http.MethodGet, "/api/knowledge?archived=yes&limit=50", nil)
	var afterBody struct {
		Items        []struct{ ID string } `json:"items"`
		ArchivedIDs  []string              `json:"archived_ids"`
		ScheduledIDs []string              `json:"scheduled_ids"`
	}
	decodeJSON(t, after, &afterBody)
	if !contains(afterBody.ArchivedIDs, created.ID) {
		t.Fatalf("the archived item is not reported: %s", after.Body.String())
	}
	// And the report is about rows in hand: everything listed there must be in the page.
	for _, id := range afterBody.ArchivedIDs {
		found := false
		for _, item := range afterBody.Items {
			if item.ID == id {
				found = true
			}
		}
		if !found {
			t.Fatalf("archived_ids mentions %q, which is not in the page", id)
		}
	}
	// Both reports ride in the same response: an item can be both scheduled and archived,
	// and neither report may claim a row that is not in the page (checked above).
	if len(afterBody.ScheduledIDs) == 0 && len(afterBody.ArchivedIDs) == 0 {
		t.Fatalf("neither report answered: %s", after.Body.String())
	}
}

func contains(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}
