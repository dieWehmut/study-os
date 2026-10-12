package httpapi_test

import (
	"net/http"
	"strings"
	"testing"

	"study-os/backend/config"
	"study-os/backend/httpapi"
)

// `?archived=yes` widens the list; anything else is a bad request.
//
// The widening direction is the point: the default view hides what was put away, so a
// caller that wants them back has to say so -- and a typo has to be answered, not ignored.
// A silently-ignored parameter would look exactly like an empty library.
func TestKnowledgeListShowsArchivedItemsOnlyWhenAsked(t *testing.T) {
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)

	dumped := requestJSON(t, router, http.MethodPost, "/api/dump", map[string]any{
		"text": "列表里的归档 / 要了就给我看",
	})
	var created struct {
		ID string `json:"id"`
	}
	decodeJSON(t, dumped, &created)
	if created.ID == "" {
		t.Fatalf("dump produced no item: %s", dumped.Body.String())
	}

	if code := requestJSON(t, router, http.MethodPost, "/api/knowledge/"+created.ID+"/archive", nil).Code; code != http.StatusOK {
		t.Fatalf("archive = %d", code)
	}

	// Default: hidden.
	defaultView := requestJSON(t, router, http.MethodGet, "/api/knowledge?limit=50", nil)
	if strings.Contains(defaultView.Body.String(), created.ID) {
		t.Fatalf("the archived item is in the default view: %s", defaultView.Body.String())
	}
	// Asked for: shown, count included.
	asked := requestJSON(t, router, http.MethodGet, "/api/knowledge?archived=yes&limit=50", nil)
	if !strings.Contains(asked.Body.String(), created.ID) {
		t.Fatalf("?archived=yes did not return the item: %s", asked.Body.String())
	}
	// A typo is a bad request rather than a silent no-op.
	bad := requestJSON(t, router, http.MethodGet, "/api/knowledge?archived=maybe", nil)
	if bad.Code != http.StatusBadRequest {
		t.Fatalf("?archived=maybe = %d, body = %s", bad.Code, bad.Body.String())
	}
}
