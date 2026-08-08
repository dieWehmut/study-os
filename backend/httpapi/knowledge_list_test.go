package httpapi_test

import (
	"net/http"
	"testing"

	"study-os/backend/config"
	"study-os/backend/httpapi"
)

// The list is where you decide what to press. Without this the 排进复习 button
// reads the same on an item that is already queued as on one that is not, and
// the only way to find out is to press it -- on a queue that has no undo.
func TestKnowledgeListSaysWhichItemsAreAlreadyQueued(t *testing.T) {
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)
	queued := createDumpedItem(t, router, "动能定理 / 适用条件\n只对合外力做功成立。")
	loose := createDumpedItem(t, router, "光合作用的两个阶段")

	scheduled := requestJSON(t, router, http.MethodPost, "/api/knowledge/"+queued+"/schedule", nil)
	if scheduled.Code != http.StatusCreated {
		t.Fatalf("schedule = %d, body = %s", scheduled.Code, scheduled.Body.String())
	}

	listed := requestJSON(t, router, http.MethodGet, "/api/knowledge?limit=50", nil)
	// Captured before decoding: decodeJSON drains the recorder, so a failure
	// message built afterwards prints nothing at all.
	body := listed.Body.String()
	var payload struct {
		ScheduledIDs []string `json:"scheduled_ids"`
	}
	decodeJSON(t, listed, &payload)

	seen := map[string]bool{}
	for _, id := range payload.ScheduledIDs {
		seen[id] = true
	}
	if !seen[queued] {
		t.Fatalf("scheduled item missing from scheduled_ids: %s", body)
	}
	if seen[loose] {
		t.Fatalf("unscheduled item listed as queued: %s", body)
	}
}

// An empty library must answer with an empty list rather than a null, because a
// caller that treats null as "unknown" would grey out every button on the page.
func TestKnowledgeListAnswersWithNoQueuedItemsRatherThanNothing(t *testing.T) {
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)
	createDumpedItem(t, router, "还没安排复习的一条")

	listed := requestJSON(t, router, http.MethodGet, "/api/knowledge?limit=50", nil)
	body := listed.Body.String()

	var payload struct {
		ScheduledIDs []string `json:"scheduled_ids"`
	}
	decodeJSON(t, listed, &payload)
	if payload.ScheduledIDs == nil {
		t.Fatalf("scheduled_ids absent or null: %s", body)
	}
	if len(payload.ScheduledIDs) != 0 {
		t.Fatalf("scheduled_ids = %v, want empty", payload.ScheduledIDs)
	}
}

// Only the page in hand is reported on. A caller reads the flags against the
// rows it was given, so an id from outside them cannot be acted on and its
// presence would only make the answer harder to trust.
func TestKnowledgeListReportsOnlyOnTheItemsItReturned(t *testing.T) {
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)
	first := createDumpedItem(t, router, "第一条 / 已安排")
	second := createDumpedItem(t, router, "第二条 / 也安排了")
	for _, id := range []string{first, second} {
		requestJSON(t, router, http.MethodPost, "/api/knowledge/"+id+"/schedule", nil)
	}

	listed := requestJSON(t, router, http.MethodGet, "/api/knowledge?limit=1", nil)

	var payload struct {
		Items []struct {
			ID string `json:"id"`
		} `json:"items"`
		ScheduledIDs []string `json:"scheduled_ids"`
	}
	decodeJSON(t, listed, &payload)
	if len(payload.Items) != 1 {
		t.Fatalf("items = %d, want 1", len(payload.Items))
	}
	if len(payload.ScheduledIDs) != 1 || payload.ScheduledIDs[0] != payload.Items[0].ID {
		t.Fatalf("scheduled_ids = %v, items = %v", payload.ScheduledIDs, payload.Items)
	}
}

func createDumpedItem(t *testing.T, router http.Handler, text string) string {
	t.Helper()
	dumped := requestJSON(t, router, http.MethodPost, "/api/dump", map[string]any{"text": text})
	if dumped.Code != http.StatusCreated {
		t.Fatalf("dump = %d, body = %s", dumped.Code, dumped.Body.String())
	}
	var created struct {
		ID string `json:"id"`
	}
	decodeJSON(t, dumped, &created)
	if created.ID == "" {
		t.Fatalf("dump returned no id: %s", dumped.Body.String())
	}
	return created.ID
}
