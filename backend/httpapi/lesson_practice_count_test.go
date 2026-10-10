package httpapi_test

import (
	"net/http"
	"testing"

	"study-os/backend/config"
	"study-os/backend/httpapi"
)

// The practice panel prints the answer count as "已作答 N 次", so it is a total
// too: three attempts asked for one at a time are still three attempts.
func TestLessonPracticeHistoryCountsEveryAttempt(t *testing.T) {
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)
	lessonID := "lesson-count-http"
	createLessonWithPractice(t, application, lessonID, map[string]any{
		"question":       "若 m = 4 kg、a = 2 m/s²，F 是多少？",
		"options":        []string{"2 N", "6 N", "8 N"},
		"correct_answer": "8 N",
	})

	for index := 0; index < 3; index += 1 {
		response := requestJSON(t, router, http.MethodPost,
			"/api/lessons/"+lessonID+"/practice/practice/attempts",
			map[string]string{"answer": "8 N"})
		if response.Code != http.StatusCreated {
			t.Fatalf("attempt %d = %d, body = %s", index, response.Code, response.Body.String())
		}
	}

	var history struct {
		Count int `json:"count"`
		Items []struct {
			ID string `json:"id"`
		} `json:"items"`
	}
	decodeJSON(t, requestJSON(t, router, http.MethodGet,
		"/api/lessons/"+lessonID+"/practice/practice/attempts?limit=1", nil), &history)
	if len(history.Items) != 1 {
		t.Fatalf("page held %d attempts, want 1", len(history.Items))
	}
	if history.Count != 3 {
		t.Fatalf("count = %d, want every attempt (3)", history.Count)
	}
}