package httpapi_test

import (
	"encoding/json"
	"net/http"
	"testing"

	"study-os/backend/app"
	"study-os/backend/config"
	"study-os/backend/httpapi"
	"study-os/backend/models"
)

func TestLessonPracticeRoutesEvaluatePersistAndList(t *testing.T) {
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)
	createLessonWithPractice(t, application, "lesson-practice-http", map[string]any{
		"question":       "若 m = 4 kg、a = 2 m/s²，F 是多少？",
		"options":        []string{"2 N", "6 N", "8 N"},
		"correct_answer": "8 N",
		"explanation":    "F = ma，所以 F = 4 × 2 = 8 N。",
	})

	correctResponse := requestJSON(t, router, http.MethodPost,
		"/api/lessons/lesson-practice-http/practice/practice/attempts", map[string]any{
			"answer": " 8 n ", "elapsed_ms": 123,
		})
	if correctResponse.Code != http.StatusCreated {
		t.Fatalf("correct status = %d; body = %s", correctResponse.Code, correctResponse.Body.String())
	}
	var correct models.LessonPracticeAttempt
	decodeJSON(t, correctResponse, &correct)
	if correct.ID == "" || correct.LessonID != "lesson-practice-http" || correct.SectionID != "practice" ||
		correct.Answer != "8 n" || correct.Evaluation != models.LessonPracticeEvaluationCorrect ||
		correct.ReferenceAnswer != "8 N" || correct.ElapsedMS != 123 || correct.CreatedAt.IsZero() {
		t.Fatalf("correct attempt = %#v", correct)
	}
	if correct.Feedback != "F = ma，所以 F = 4 × 2 = 8 N。" {
		t.Fatalf("correct feedback = %q", correct.Feedback)
	}
	var memoryAttempts int
	if err := application.Store.SQL().QueryRow(`SELECT COUNT(*) FROM attempts`).Scan(&memoryAttempts); err != nil {
		t.Fatalf("count memory attempts: %v", err)
	}
	if memoryAttempts != 0 {
		t.Fatalf("lesson practice unexpectedly created %d memory attempts", memoryAttempts)
	}

	incorrectResponse := requestJSON(t, router, http.MethodPost,
		"/api/lessons/lesson-practice-http/practice/practice/attempts", map[string]any{
			"answer": "2 N", "elapsed_ms": 456,
		})
	if incorrectResponse.Code != http.StatusCreated {
		t.Fatalf("incorrect status = %d; body = %s", incorrectResponse.Code, incorrectResponse.Body.String())
	}
	var incorrect models.LessonPracticeAttempt
	decodeJSON(t, incorrectResponse, &incorrect)
	if incorrect.Evaluation != models.LessonPracticeEvaluationIncorrect ||
		incorrect.ReferenceAnswer != "8 N" || incorrect.Feedback == "" {
		t.Fatalf("incorrect attempt = %#v", incorrect)
	}

	listResponse := requestJSON(t, router, http.MethodGet,
		"/api/lessons/lesson-practice-http/practice/practice/attempts", nil)
	if listResponse.Code != http.StatusOK {
		t.Fatalf("list status = %d; body = %s", listResponse.Code, listResponse.Body.String())
	}
	var history struct {
		Items []models.LessonPracticeAttempt `json:"items"`
		Count int                            `json:"count"`
	}
	decodeJSON(t, listResponse, &history)
	if history.Count != 2 || len(history.Items) != 2 ||
		history.Items[0].ID != incorrect.ID || history.Items[1].ID != correct.ID {
		t.Fatalf("history = %#v", history)
	}
}

func TestLessonPracticeRoutesPersistUngradedAnswerWithoutKey(t *testing.T) {
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)
	createLessonWithPractice(t, application, "lesson-ungraded-http", map[string]any{
		"question": "请用自己的话说明公式的使用条件。",
		"options":  []string{"自由回答"},
		"feedback": "请对照课程总结复盘。",
	})

	response := requestJSON(t, router, http.MethodPost,
		"/api/lessons/lesson-ungraded-http/practice/practice/attempts", map[string]any{
			"answer": "先统一单位", "elapsed_ms": 45,
		})
	if response.Code != http.StatusCreated {
		t.Fatalf("status = %d; body = %s", response.Code, response.Body.String())
	}
	var attempt models.LessonPracticeAttempt
	decodeJSON(t, response, &attempt)
	if attempt.Evaluation != models.LessonPracticeEvaluationUngraded ||
		attempt.ReferenceAnswer != "" || attempt.Feedback != "请对照课程总结复盘。" {
		t.Fatalf("ungraded attempt = %#v", attempt)
	}
}

func TestLessonPracticeRoutesTreatLegacyTextAsUngraded(t *testing.T) {
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)
	document := models.NewLessonDocument()
	for index := range document.Sections {
		if document.Sections[index].ID == "practice" {
			document.Sections[index].Content = json.RawMessage(`"先画受力图，再代入公式"`)
		}
	}
	if err := application.Store.CreateLesson(t.Context(), models.Lesson{
		ID: "lesson-legacy-practice", Title: "旧练习", Document: document,
	}); err != nil {
		t.Fatalf("create lesson: %v", err)
	}

	response := requestJSON(t, router, http.MethodPost,
		"/api/lessons/lesson-legacy-practice/practice/practice/attempts", map[string]any{
			"answer": "我会先画图",
		})
	if response.Code != http.StatusCreated {
		t.Fatalf("status = %d; body = %s", response.Code, response.Body.String())
	}
	var attempt models.LessonPracticeAttempt
	decodeJSON(t, response, &attempt)
	if attempt.Evaluation != models.LessonPracticeEvaluationUngraded || attempt.ReferenceAnswer != "" {
		t.Fatalf("legacy attempt = %#v", attempt)
	}
}

func TestLessonPracticeRoutesRejectInvalidInputAndMissingRecords(t *testing.T) {
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)
	createLessonWithPractice(t, application, "lesson-invalid-http", map[string]any{
		"question":       "选择答案",
		"options":        []string{"A", "B"},
		"correct_answer": "A",
	})
	route := "/api/lessons/lesson-invalid-http/practice/practice/attempts"

	for _, testCase := range []struct {
		name   string
		method string
		target string
		body   any
		status int
	}{
		{name: "empty answer", method: http.MethodPost, target: route, body: map[string]any{"answer": "   ", "elapsed_ms": 1}, status: http.StatusBadRequest},
		{name: "negative elapsed", method: http.MethodPost, target: route, body: map[string]any{"answer": "A", "elapsed_ms": -1}, status: http.StatusBadRequest},
		{name: "fractional elapsed", method: http.MethodPost, target: route, body: map[string]any{"answer": "A", "elapsed_ms": 1.5}, status: http.StatusBadRequest},
		{name: "unknown field", method: http.MethodPost, target: route, body: map[string]any{"answer": "A", "extra": true}, status: http.StatusBadRequest},
		{name: "missing lesson post", method: http.MethodPost, target: "/api/lessons/missing/practice/practice/attempts", body: map[string]any{"answer": "A"}, status: http.StatusNotFound},
		{name: "missing section post", method: http.MethodPost, target: "/api/lessons/lesson-invalid-http/practice/missing/attempts", body: map[string]any{"answer": "A"}, status: http.StatusNotFound},
		{name: "missing lesson list", method: http.MethodGet, target: "/api/lessons/missing/practice/practice/attempts", status: http.StatusNotFound},
		{name: "missing section list", method: http.MethodGet, target: "/api/lessons/lesson-invalid-http/practice/missing/attempts", status: http.StatusNotFound},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			response := requestJSON(t, router, testCase.method, testCase.target, testCase.body)
			if response.Code != testCase.status {
				t.Fatalf("status = %d, want %d; body = %s", response.Code, testCase.status, response.Body.String())
			}
		})
	}
}

func createLessonWithPractice(t *testing.T, application *app.App, id string, content any) {
	t.Helper()
	document := models.NewLessonDocument()
	for index := range document.Sections {
		if document.Sections[index].ID != "practice" {
			continue
		}
		encoded, err := json.Marshal(content)
		if err != nil {
			t.Fatalf("encode practice content: %v", err)
		}
		document.Sections[index].Content = encoded
	}
	if err := application.Store.CreateLesson(t.Context(), models.Lesson{
		ID: id, Title: "即时练习 API", Document: document,
	}); err != nil {
		t.Fatalf("create lesson: %v", err)
	}
}
