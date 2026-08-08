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

func TestMistakeEndpointTakesBackARowFiledWrong(t *testing.T) {
	// Naming a cause happens in the second after getting something wrong, which
	// is exactly when you misclick. A log you cannot correct is one you stop
	// trusting, and then stop keeping.
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)

	filed := requestJSON(t, router, http.MethodPost, "/api/mistakes", map[string]any{
		"subject": "physics", "stem": "受力分析", "cause": "careless",
	})
	var created struct {
		Attempt struct {
			ID string `json:"id"`
		} `json:"attempt"`
	}
	decodeJSON(t, filed, &created)

	removed := requestJSON(t, router, http.MethodDelete, "/api/mistakes/"+created.Attempt.ID, nil)
	if removed.Code != http.StatusNoContent {
		t.Fatalf("delete = %d, body = %s", removed.Code, removed.Body.String())
	}

	listed := requestJSON(t, router, http.MethodGet, "/api/mistakes", nil)
	listedBody := listed.Body.String()
	var page struct {
		Count int `json:"count"`
	}
	decodeJSON(t, listed, &page)
	if page.Count != 0 {
		t.Fatalf("count after delete = %d, body = %s", page.Count, listedBody)
	}
}

func TestMistakeDeleteSaysSoWhenThereIsNothingToDelete(t *testing.T) {
	// chi answers 404 for any route it does not know, so a status-only
	// assertion would pass before the endpoint existed. The JSON error is what
	// proves the handler ran.
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)

	missing := requestJSON(t, router, http.MethodDelete, "/api/mistakes/nope", nil)
	body := missing.Body.String()
	if missing.Code != http.StatusNotFound {
		t.Fatalf("delete missing = %d, body = %s", missing.Code, body)
	}
	var failure struct {
		Error string `json:"error"`
	}
	decodeJSON(t, missing, &failure)
	if failure.Error == "" {
		t.Fatalf("expected a JSON error payload, body = %s", body)
	}
}

func TestMistakeCorrectEndpointMarksTheRowWithoutRemovingIt(t *testing.T) {
	// 取消 is for a row filed by mistake; 订正 is for a mistake you have since
	// fixed. Deleting on 订正 would erase the only evidence you ever got it
	// wrong -- which is the one thing a 错题本 exists to keep.
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)

	filed := requestJSON(t, router, http.MethodPost, "/api/mistakes", map[string]any{
		"subject": "physics", "stem": "受力分析", "cause": "method",
	})
	var created struct {
		Attempt struct {
			ID string `json:"id"`
		} `json:"attempt"`
		Corrected bool `json:"corrected"`
	}
	decodeJSON(t, filed, &created)
	if created.Corrected {
		t.Fatalf("a mistake is not corrected the moment it is filed")
	}

	corrected := requestJSON(t, router, http.MethodPost, "/api/mistakes/"+created.Attempt.ID+"/correct", nil)
	correctedBody := corrected.Body.String()
	if corrected.Code != http.StatusOK {
		t.Fatalf("correct = %d, body = %s", corrected.Code, correctedBody)
	}
	var result struct {
		Corrected bool `json:"corrected"`
	}
	decodeJSON(t, corrected, &result)
	if !result.Corrected {
		t.Fatalf("corrected flag missing, body = %s", correctedBody)
	}

	listed := requestJSON(t, router, http.MethodGet, "/api/mistakes", nil)
	listedBody := listed.Body.String()
	var page struct {
		Count int `json:"count"`
		Items []struct {
			Corrected bool `json:"corrected"`
			Attempt   struct {
				ID string `json:"id"`
			} `json:"attempt"`
		} `json:"items"`
	}
	decodeJSON(t, listed, &page)
	if page.Count != 1 {
		t.Fatalf("count after correcting = %d, body = %s", page.Count, listedBody)
	}
	if page.Items[0].Attempt.ID != created.Attempt.ID || !page.Items[0].Corrected {
		t.Fatalf("listed row = %#v, body = %s", page.Items[0], listedBody)
	}
}

func TestMistakeCorrectSaysSoWhenThereIsNothingToCorrect(t *testing.T) {
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)

	missing := requestJSON(t, router, http.MethodPost, "/api/mistakes/never-filed/correct", nil)
	body := missing.Body.String()
	if missing.Code != http.StatusNotFound {
		t.Fatalf("correct missing = %d, body = %s", missing.Code, body)
	}
	var failure struct {
		Error string `json:"error"`
	}
	decodeJSON(t, missing, &failure)
	if failure.Error == "" {
		t.Fatalf("expected a JSON error payload, body = %s", body)
	}
}
