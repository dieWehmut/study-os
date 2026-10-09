package httpapi_test

import (
	"net/http"
	"testing"

	"study-os/backend/config"
	"study-os/backend/httpapi"
)

// 答疑 links a knowledge point by id. The list answers 复习状态 only for the
// page it was asked about -- capped at 100 and filtered by subject -- so a
// caller holding one id has no way to know whether that item already carries
// cards. It is the same id it already had to fetch to show the item's name, so
// the answer belongs on that read.
func TestKnowledgeDetailSaysWhetherTheItemIsInTheQueue(t *testing.T) {
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)
	itemID := createDumpedItem(t, router, "动能定理 / 适用条件\n只对合外力做功成立。")

	var before struct {
		ID        string `json:"id"`
		Term      string `json:"term"`
		Scheduled bool   `json:"scheduled"`
	}
	detail := requestJSON(t, router, http.MethodGet, "/api/knowledge/"+itemID, nil)
	if detail.Code != http.StatusOK {
		t.Fatalf("detail = %d, body = %s", detail.Code, detail.Body.String())
	}
	decodeJSON(t, detail, &before)
	if before.ID != itemID || before.Term == "" {
		t.Fatalf("detail lost the item itself: %+v", before)
	}
	if before.Scheduled {
		t.Errorf("scheduled = true before anything queued it")
	}

	scheduled := requestJSON(t, router, http.MethodPost, "/api/knowledge/"+itemID+"/schedule", nil)
	if scheduled.Code != http.StatusCreated {
		t.Fatalf("schedule = %d, body = %s", scheduled.Code, scheduled.Body.String())
	}

	var after struct {
		Scheduled bool `json:"scheduled"`
	}
	queued := requestJSON(t, router, http.MethodGet, "/api/knowledge/"+itemID, nil)
	decodeJSON(t, queued, &after)
	if !after.Scheduled {
		t.Errorf("scheduled = false for an item that just answered 排进复习")
	}
}