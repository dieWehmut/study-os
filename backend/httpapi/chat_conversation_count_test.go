package httpapi_test

import (
	"fmt"
	"net/http"
	"testing"

	"study-os/backend/config"
	"study-os/backend/httpapi"
)

// The conversation list is one page of the newest sessions, and `count` is how
// many there are: a sidebar that reports 50 when you have 120 conversations is
// the same lie the knowledge list used to tell.
func TestChatConversationListPagesAndCountsWhatMatches(t *testing.T) {
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)
	for index := 0; index < 5; index += 1 {
		response := requestJSON(t, router, http.MethodPost, "/api/chat", map[string]string{
			"subject": "math",
			"message": fmt.Sprintf("第 %d 个问题", index),
		})
		// 202: the answer is produced in the background.
		if response.Code != http.StatusAccepted {
			t.Fatalf("send %d = %d, body = %s", index, response.Code, response.Body.String())
		}
	}

	var first struct {
		Count int `json:"count"`
		Items []struct {
			SessionID string `json:"session_id"`
		} `json:"items"`
	}
	decodeJSON(t, requestJSON(t, router, http.MethodGet, "/api/chat/conversations?subject=math&limit=2", nil), &first)
	if len(first.Items) != 2 {
		t.Fatalf("page held %d conversations, want 2", len(first.Items))
	}
	if first.Count != 5 {
		t.Fatalf("count = %d, want every conversation (5)", first.Count)
	}

	var second struct {
		Items []struct {
			SessionID string `json:"session_id"`
		} `json:"items"`
	}
	decodeJSON(t, requestJSON(t, router, http.MethodGet, "/api/chat/conversations?subject=math&limit=2&offset=2", nil), &second)
	if len(second.Items) != 2 {
		t.Fatalf("second page held %d conversations, want 2", len(second.Items))
	}
	if second.Items[0].SessionID == first.Items[0].SessionID {
		t.Fatalf("offset went nowhere: both pages start at %s", first.Items[0].SessionID)
	}

	// The count follows the text filter too.
	var filtered struct {
		Count int `json:"count"`
	}
	decodeJSON(t, requestJSON(t, router, http.MethodGet,
		"/api/chat/conversations?subject=math&q=%E7%AC%AC%203%20%E4%B8%AA%E9%97%AE%E9%A2%98", nil), &filtered)
	if filtered.Count != 1 {
		t.Fatalf("filtered count = %d, want 1", filtered.Count)
	}
}