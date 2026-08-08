package httpapi_test

import (
	"net/http"
	"testing"

	"study-os/backend/config"
	"study-os/backend/httpapi"
)

func TestMistakeEndpointFilesAWrongAnswer(t *testing.T) {
	// 做题 has been writing its mistake log to localStorage, so nothing in the
	// system could see it. The endpoint is what makes a filed mistake a row
	// that survives the browser.
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)

	filed := requestJSON(t, router, http.MethodPost, "/api/mistakes", map[string]any{
		"subject": "physics",
		"stem":    "小球从斜面顶端滑下，求到底端的速度。",
		"cause":   "method",
		"note":    "忘了摩擦力做负功",
	})
	body := filed.Body.String()
	if filed.Code != http.StatusCreated {
		t.Fatalf("file mistake = %d, body = %s", filed.Code, body)
	}
	var created struct {
		Question struct {
			ID   string `json:"id"`
			Stem string `json:"stem"`
		} `json:"question"`
		Attempt struct {
			ID         string `json:"id"`
			QuestionID string `json:"question_id"`
			Cause      string `json:"cause"`
		} `json:"attempt"`
	}
	decodeJSON(t, filed, &created)
	if created.Question.ID == "" || created.Attempt.QuestionID != created.Question.ID {
		t.Fatalf("created = %#v, body = %s", created, body)
	}
	if created.Attempt.Cause != "method" {
		t.Fatalf("cause = %q, body = %s", created.Attempt.Cause, body)
	}
}

func TestMistakeListNarrowsToTheSubjectInHand(t *testing.T) {
	// Every list in the app follows the 首页 subject switch. A mistake log that
	// ignored it would show 地理 errors while you are working through 物理.
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)

	for _, filed := range []map[string]any{
		{"subject": "physics", "stem": "受力分析", "cause": "method"},
		{"subject": "geography", "stem": "城市化对水循环的影响", "cause": "recall"},
	} {
		recorded := requestJSON(t, router, http.MethodPost, "/api/mistakes", filed)
		if recorded.Code != http.StatusCreated {
			t.Fatalf("file %v = %d, body = %s", filed, recorded.Code, recorded.Body.String())
		}
	}

	listed := requestJSON(t, router, http.MethodGet, "/api/mistakes?subject=geography", nil)
	listedBody := listed.Body.String()
	if listed.Code != http.StatusOK {
		t.Fatalf("list = %d, body = %s", listed.Code, listedBody)
	}
	var page struct {
		Count int `json:"count"`
		Items []struct {
			Question struct {
				Subject string `json:"subject"`
				Stem    string `json:"stem"`
			} `json:"question"`
		} `json:"items"`
	}
	decodeJSON(t, listed, &page)
	if page.Count != 1 || len(page.Items) != 1 {
		t.Fatalf("page = %#v, body = %s", page, listedBody)
	}
	if page.Items[0].Question.Subject != "geography" {
		t.Fatalf("subject = %q, body = %s", page.Items[0].Question.Subject, listedBody)
	}
}

func TestMistakeEndpointRefusesAnEmptyStem(t *testing.T) {
	// A row with no question text can never be re-attempted, classified, or
	// matched to a knowledge point. Accepting it would only grow the count.
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)

	refused := requestJSON(t, router, http.MethodPost, "/api/mistakes", map[string]any{
		"subject": "math", "stem": "   ",
	})
	if refused.Code != http.StatusBadRequest {
		t.Fatalf("empty stem = %d, body = %s", refused.Code, refused.Body.String())
	}
}
