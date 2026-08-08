package httpapi_test

import (
	"net/http"
	"testing"

	"study-os/backend/config"
	"study-os/backend/httpapi"
)

func TestKnowledgeRelatedListsTheRestOfTheGroupButNotTheItemItself(t *testing.T) {
	// The English pipeline has been grouping words by lemma into word_family
	// groups since it was written, and 错因 advice already tells you to review
	// the family together -- but nothing could ever show you the family. The
	// only way to see it was to know a group id you were never told.
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)
	subject := createDumpedItem(t, router, "abandon / 放弃")
	sibling := createDumpedItem(t, router, "abandonment / 放弃")
	stranger := createDumpedItem(t, router, "光合作用的两个阶段")
	createGroupWithItems(t, application, "abandon 词族", subject, sibling)

	related := requestJSON(t, router, http.MethodGet, "/api/knowledge/"+subject+"/related", nil)
	body := related.Body.String()
	if related.Code != http.StatusOK {
		t.Fatalf("related = %d, body = %s", related.Code, body)
	}
	var payload struct {
		Count int `json:"count"`
		Items []struct {
			ID string `json:"id"`
		} `json:"items"`
		Groups []struct {
			Name string `json:"name"`
		} `json:"groups"`
	}
	decodeJSON(t, related, &payload)
	if payload.Count != 1 || len(payload.Items) != 1 {
		t.Fatalf("payload = %#v, body = %s", payload, body)
	}
	if payload.Items[0].ID != sibling {
		t.Fatalf("item = %s, want the sibling %s (and never %s): %s",
			payload.Items[0].ID, sibling, stranger, body)
	}
	// The group is what lets the panel say *why* these words are together.
	if len(payload.Groups) != 1 || payload.Groups[0].Name != "abandon 词族" {
		t.Fatalf("groups = %#v, body = %s", payload.Groups, body)
	}
}

func TestKnowledgeRelatedAnswersWithNothingRatherThanNull(t *testing.T) {
	// Most items belong to no group at all. A null would read as "unknown" and
	// leave the panel showing a spinner for a section that will never fill.
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)
	lonely := createDumpedItem(t, router, "动能定理 / 适用条件")

	related := requestJSON(t, router, http.MethodGet, "/api/knowledge/"+lonely+"/related", nil)
	body := related.Body.String()
	if related.Code != http.StatusOK {
		t.Fatalf("related = %d, body = %s", related.Code, body)
	}
	var payload struct {
		Count  int   `json:"count"`
		Items  []any `json:"items"`
		Groups []any `json:"groups"`
	}
	decodeJSON(t, related, &payload)
	if payload.Items == nil || payload.Groups == nil {
		t.Fatalf("items or groups came back null: %s", body)
	}
	if payload.Count != 0 || len(payload.Items) != 0 {
		t.Fatalf("payload = %#v, body = %s", payload, body)
	}
}

func TestKnowledgeRelatedSaysSoWhenThereIsNoSuchItem(t *testing.T) {
	// chi answers 404 for any route it does not know, so a status-only
	// assertion would pass before the endpoint existed. The JSON error is what
	// proves the handler ran.
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)

	missing := requestJSON(t, router, http.MethodGet, "/api/knowledge/never-filed/related", nil)
	body := missing.Body.String()
	if missing.Code != http.StatusNotFound {
		t.Fatalf("related missing = %d, body = %s", missing.Code, body)
	}
	var failure struct {
		Error string `json:"error"`
	}
	decodeJSON(t, missing, &failure)
	if failure.Error == "" {
		t.Fatalf("expected a JSON error payload, body = %s", body)
	}
}
