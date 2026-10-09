package httpapi_test

import (
	"net/http"
	"strings"
	"testing"

	"study-os/backend/config"
	"study-os/backend/httpapi"
)

// The filter for these endpoints is deliberately about the *shape* of an empty
// answer, not about any one feature: Go marshals a nil slice as `null`, and the
// frontend indexes these fields. A `null` here is the bug that blanked 记忆 when
// a card had no reference answers -- same cause, different endpoint.
func TestListEndpointsAnswerWithListsOnAnEmptyDatabase(t *testing.T) {
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)

	for _, target := range []string{
		"/api/knowledge?limit=50",
		"/api/groups",
		"/api/mistakes",
		"/api/lessons",
		"/api/chat/conversations",
		"/api/reviews/due",
		"/api/speech/roles",
		"/api/english/articles",
	} {
		response := requestJSON(t, router, http.MethodGet, target, nil)
		if response.Code != http.StatusOK {
			t.Errorf("%s = %d, want 200; body = %s", target, response.Code, response.Body.String())
			continue
		}
		body := response.Body.String()
		if !strings.Contains(body, `"items":[`) {
			t.Errorf("%s did not answer with a list: %s", target, body)
		}
		if strings.Contains(body, `"items":null`) {
			t.Errorf("%s answered null where the client iterates: %s", target, body)
		}
	}
}

func TestEmptyKnowledgeListReportsAnEmptyScheduledIDList(t *testing.T) {
	// The 复习状态 filter reads this array on every visit, before any item
	// exists. `null` there is read as "the server did not answer", which is a
	// different claim from "nothing is scheduled".
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)

	response := requestJSON(t, router, http.MethodGet, "/api/knowledge?limit=50", nil)
	body := response.Body.String()
	if !strings.Contains(body, `"scheduled_ids":[]`) {
		t.Fatalf("scheduled_ids is not an empty list: %s", body)
	}

	item := createDumpedItem(t, router, "空队列的相关知识点")
	related := requestJSON(t, router, http.MethodGet, "/api/knowledge/"+item+"/related", nil)
	if related.Code != http.StatusOK {
		t.Fatalf("related = %d, want 200; body = %s", related.Code, related.Body.String())
	}
	relatedBody := related.Body.String()
	for _, marker := range []string{`"items":[]`, `"groups":[]`} {
		if !strings.Contains(relatedBody, marker) {
			t.Errorf("related is missing %s: %s", marker, relatedBody)
		}
	}
}