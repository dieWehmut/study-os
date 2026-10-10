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
// 综合 is every subject. Reading "all" as a literal subject left the sidebar
// empty -- 还没有对话 -- for a reader whose conversations were all asked under a
// subject, which is what the messages endpoint next to it never did.
func TestChatConversationsOnTheCombinedSubjectShowEverySubject(t *testing.T) {
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)
	for _, subject := range []string{"math", "physics", "all"} {
		response := requestJSON(t, router, http.MethodPost, "/api/chat", map[string]string{
			"subject": subject,
			"message": subject + " 的问题",
		})
		if response.Code != http.StatusAccepted {
			t.Fatalf("send to %s = %d, body = %s", subject, response.Code, response.Body.String())
		}
	}

	var combined struct {
		Count int `json:"count"`
	}
	decodeJSON(t, requestJSON(t, router, http.MethodGet, "/api/chat/conversations", nil), &combined)
	if combined.Count != 3 {
		t.Fatalf("综合 counted %d conversations, want all 3", combined.Count)
	}
	decodeJSON(t, requestJSON(t, router, http.MethodGet, "/api/chat/conversations?subject=all", nil), &combined)
	if combined.Count != 3 {
		t.Fatalf("subject=all counted %d, want all 3", combined.Count)
	}

	var named struct {
		Count int `json:"count"`
	}
	decodeJSON(t, requestJSON(t, router, http.MethodGet, "/api/chat/conversations?subject=physics", nil), &named)
	if named.Count != 1 {
		t.Fatalf("physics counted %d, want 1", named.Count)
	}
}

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
