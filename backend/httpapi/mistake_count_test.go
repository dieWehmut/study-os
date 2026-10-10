package httpapi_test

import (
	"fmt"
	"net/http"
	"testing"

	"study-os/backend/config"
	"study-os/backend/httpapi"
)

// The 记录 card offers a next page from `count`, so `count` has to be how many
// mistakes there are and not how many fit in the page it just read.
func TestMistakeListPagesAndCountsWhatMatches(t *testing.T) {
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)
	for index := 0; index < 5; index += 1 {
		response := requestJSON(t, router, http.MethodPost, "/api/mistakes", map[string]string{
			"subject": "math",
			"stem":    fmt.Sprintf("第 %d 题", index),
			"cause":   "method",
		})
		if response.Code != http.StatusCreated {
			t.Fatalf("create %d = %d, body = %s", index, response.Code, response.Body.String())
		}
	}

	var first struct {
		Count int `json:"count"`
		Items []struct {
			Attempt struct {
				ID string `json:"id"`
			} `json:"attempt"`
		} `json:"items"`
	}
	decodeJSON(t, requestJSON(t, router, http.MethodGet, "/api/mistakes?limit=2", nil), &first)
	if len(first.Items) != 2 {
		t.Fatalf("page held %d mistakes, want 2", len(first.Items))
	}
	if first.Count != 5 {
		t.Fatalf("count = %d, want the whole log (5)", first.Count)
	}

	var second struct {
		Items []struct {
			Attempt struct {
				ID string `json:"id"`
			} `json:"attempt"`
		} `json:"items"`
	}
	decodeJSON(t, requestJSON(t, router, http.MethodGet, "/api/mistakes?limit=2&offset=2", nil), &second)
	if len(second.Items) != 2 {
		t.Fatalf("second page held %d mistakes, want 2", len(second.Items))
	}
	if second.Items[0].Attempt.ID == first.Items[0].Attempt.ID {
		t.Fatalf("offset went nowhere: both pages start at %s", first.Items[0].Attempt.ID)
	}

	var filtered struct {
		Count int `json:"count"`
	}
	decodeJSON(t, requestJSON(t, router, http.MethodGet, "/api/mistakes?q=第%203%20题", nil), &filtered)
	if filtered.Count != 1 {
		t.Fatalf("filtered count = %d, want 1", filtered.Count)
	}

	// 订正 writes a second attempt on the same question. It is not a mistake, so
	// neither the page nor the number may count it.
	target := first.Items[0].Attempt.ID
	corrected := requestJSON(t, router, http.MethodPost, "/api/mistakes/"+target+"/correct",
		map[string]any{"answer": "订正后的答案", "elapsed_ms": 100})
	if corrected.Code != http.StatusOK {
		t.Fatalf("correct = %d, body = %s", corrected.Code, corrected.Body.String())
	}
	var afterCorrection struct {
		Count int `json:"count"`
	}
	decodeJSON(t, requestJSON(t, router, http.MethodGet, "/api/mistakes?limit=2", nil), &afterCorrection)
	if afterCorrection.Count != 5 {
		t.Fatalf("count after 订正 = %d, want 5 (the correction is not a mistake)", afterCorrection.Count)
	}
}
