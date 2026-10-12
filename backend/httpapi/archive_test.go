package httpapi_test

import (
	"net/http"
	"strings"
	"testing"

	"study-os/backend/config"
	"study-os/backend/httpapi"
)

// 归档 from the outside (ROADMAP §8.1): the list drops it, the count drops with it, and
// the single-item read keeps answering -- because a link someone already has must not
// break just because the item was put away. Nothing is deleted, so 取消归档 restores it
// exactly.
func TestArchiveEndpointHidesAnItemAndKeepsTheLinkWorking(t *testing.T) {
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)

	dumped := requestJSON(t, router, http.MethodPost, "/api/dump", map[string]any{
		"text": "归档的端到端 / 藏起来不等于不存在",
	})
	if dumped.Code != http.StatusCreated {
		t.Fatalf("dump = %d, body = %s", dumped.Code, dumped.Body.String())
	}
	var created struct {
		ID string `json:"id"`
	}
	decodeJSON(t, dumped, &created)

	before := requestJSON(t, router, http.MethodGet, "/api/knowledge?limit=50", nil)
	if !strings.Contains(before.Body.String(), created.ID) {
		t.Fatalf("the item is not in the library to begin with: %s", before.Body.String())
	}

	archived := requestJSON(t, router, http.MethodPost, "/api/knowledge/"+created.ID+"/archive", nil)
	if archived.Code != http.StatusOK || !strings.Contains(archived.Body.String(), "archived") {
		t.Fatalf("archive = %d, body = %s", archived.Code, archived.Body.String())
	}

	after := requestJSON(t, router, http.MethodGet, "/api/knowledge?limit=50", nil)
	if strings.Contains(after.Body.String(), created.ID) {
		t.Fatalf("the archived item is still listed: %s", after.Body.String())
	}

	// ① The deep link still works -- it is the one thing 归档 must not break.
	detail := requestJSON(t, router, http.MethodGet, "/api/knowledge/"+created.ID, nil)
	if detail.Code != http.StatusOK {
		t.Fatalf("deep link to an archived item = %d, body = %s", detail.Code, detail.Body.String())
	}

	// ③ 取消归档 puts it back, and pressing archive twice is not an error.
	if again := requestJSON(t, router, http.MethodPost, "/api/knowledge/"+created.ID+"/archive", nil); again.Code != http.StatusOK {
		t.Fatalf("second archive = %d, body = %s", again.Code, again.Body.String())
	}
	restored := requestJSON(t, router, http.MethodDelete, "/api/knowledge/"+created.ID+"/archive", nil)
	if restored.Code != http.StatusOK || !strings.Contains(restored.Body.String(), "unarchived") {
		t.Fatalf("unarchive = %d, body = %s", restored.Code, restored.Body.String())
	}
	back := requestJSON(t, router, http.MethodGet, "/api/knowledge?limit=50", nil)
	if !strings.Contains(back.Body.String(), created.ID) {
		t.Fatalf("the item did not come back: %s", back.Body.String())
	}
}

func TestArchiveEndpointRefusesAnItemThatIsNotThere(t *testing.T) {
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)

	missing := requestJSON(t, router, http.MethodPost, "/api/knowledge/nope/archive", nil)
	if missing.Code != http.StatusNotFound {
		t.Fatalf("archiving a missing item = %d, body = %s", missing.Code, missing.Body.String())
	}
}
