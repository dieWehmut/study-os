package httpapi_test

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"study-os/backend/config"
	"study-os/backend/db"
	"study-os/backend/httpapi"
)

// fileMistake files one wrong answer and hands back the attempt id, which is
// what a row on the Practice page actually is.
func fileMistake(t *testing.T, router http.Handler, body map[string]any) string {
	t.Helper()
	filed := requestJSON(t, router, http.MethodPost, "/api/mistakes", body)
	if filed.Code != http.StatusCreated {
		t.Fatalf("file mistake = %d, body = %s", filed.Code, filed.Body.String())
	}
	var created struct {
		Attempt struct {
			ID string `json:"id"`
		} `json:"attempt"`
	}
	decodeJSON(t, filed, &created)
	if created.Attempt.ID == "" {
		t.Fatal("filed mistake has no attempt id")
	}
	return created.Attempt.ID
}

func scheduledAnswersForKnowledge(t *testing.T, store *db.Store, knowledgeID string) (string, []string) {
	t.Helper()
	var promptType, rawAnswers string
	if err := store.SQL().QueryRowContext(context.Background(), `
		SELECT prompt_type, accepted_answers_json
		FROM prompts
		WHERE knowledge_item_id = ?`, knowledgeID,
	).Scan(&promptType, &rawAnswers); err != nil {
		t.Fatalf("read scheduled prompt: %v", err)
	}
	var answers []string
	if err := json.Unmarshal([]byte(rawAnswers), &answers); err != nil {
		t.Fatalf("decode scheduled answers %q: %v", rawAnswers, err)
	}
	return promptType, answers
}

func TestMistakeScheduleEndpointPutsAForgottenQuestionIntoTheReviewQueue(t *testing.T) {
	// 想不起来 is the one cause more review actually fixes, and until now the
	// page could only say so. The queue joins review_states through prompts,
	// which hang off a knowledge item, so a filed mistake is invisible to 复习
	// until something turns the question into one.
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)
	attemptID := fileMistake(t, router, map[string]any{
		"subject": "physics",
		"stem":    "小球从斜面顶端滑下，求到底端的速度。",
		"cause":   "recall",
		"note":    "动能定理：mgh - μmgcosθ·s = ½mv²",
	})

	scheduled := requestJSON(t, router, http.MethodPost, "/api/mistakes/"+attemptID+"/schedule", nil)
	body := scheduled.Body.String()
	if scheduled.Code != http.StatusCreated {
		t.Fatalf("schedule = %d, body = %s", scheduled.Code, body)
	}
	var result struct {
		Status      string `json:"status"`
		KnowledgeID string `json:"knowledge_id"`
		PromptCount int    `json:"prompt_count"`
	}
	decodeJSON(t, scheduled, &result)
	if result.Status != "scheduled" || result.KnowledgeID == "" || result.PromptCount == 0 {
		t.Fatalf("result = %#v, body = %s", result, body)
	}

	due := requestJSON(t, router, http.MethodGet, "/api/reviews/due?limit=20", nil)
	dueBody := due.Body.String()
	if due.Code != http.StatusOK || !strings.Contains(dueBody, "小球从斜面顶端滑下") {
		t.Fatalf("due = %d, body = %s", due.Code, dueBody)
	}
}

func TestMistakeScheduleUsesOnlyTheConfirmedCorrectionAsAnAcceptedAnswer(t *testing.T) {
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)
	attemptID := fileMistake(t, router, map[string]any{
		"subject": "physics",
		"stem":    "F = ma，m = 2 kg、a = 3 m/s²，求合力。",
		"cause":   "recall",
		"answer":  "5 N",
		"note":    "先确认研究对象和正方向",
	})

	corrected := requestJSON(t, router, http.MethodPost, "/api/mistakes/"+attemptID+"/correct", map[string]any{
		"answer": "6 N", "elapsed_ms": 1200,
	})
	if corrected.Code != http.StatusOK {
		t.Fatalf("correct = %d, body = %s", corrected.Code, corrected.Body.String())
	}

	scheduled := requestJSON(t, router, http.MethodPost, "/api/mistakes/"+attemptID+"/schedule", nil)
	if scheduled.Code != http.StatusCreated {
		t.Fatalf("schedule = %d, body = %s", scheduled.Code, scheduled.Body.String())
	}
	var result struct {
		KnowledgeID string `json:"knowledge_id"`
	}
	decodeJSON(t, scheduled, &result)
	promptType, answers := scheduledAnswersForKnowledge(t, application.Store, result.KnowledgeID)
	if promptType != "mistake_redo" {
		t.Fatalf("prompt type = %q", promptType)
	}
	if len(answers) != 1 || answers[0] != "6 N" {
		t.Fatalf("accepted answers = %#v, want only the confirmed correction", answers)
	}
	for _, forbidden := range []string{"5 N", "先确认研究对象和正方向"} {
		if strings.Contains(strings.Join(answers, "\n"), forbidden) {
			t.Fatalf("accepted answers leaked %q: %#v", forbidden, answers)
		}
	}
}

func TestMistakeScheduleWithoutACorrectionKeepsAcceptedAnswersEmpty(t *testing.T) {
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)
	attemptID := fileMistake(t, router, map[string]any{
		"subject": "geography",
		"stem":    "说明季风气候的成因。",
		"cause":   "recall",
		"answer":  "海陆热力差异不明显",
		"note":    "先看海陆位置和季节",
	})

	scheduled := requestJSON(t, router, http.MethodPost, "/api/mistakes/"+attemptID+"/schedule", nil)
	if scheduled.Code != http.StatusCreated {
		t.Fatalf("schedule = %d, body = %s", scheduled.Code, scheduled.Body.String())
	}
	var result struct {
		KnowledgeID string `json:"knowledge_id"`
	}
	decodeJSON(t, scheduled, &result)
	_, answers := scheduledAnswersForKnowledge(t, application.Store, result.KnowledgeID)
	if len(answers) != 0 {
		t.Fatalf("accepted answers = %#v, want none before a confirmed correction", answers)
	}
}

func TestMistakeScheduleEndpointRefusesACauseMoreReviewCannotFix(t *testing.T) {
	// The load-bearing claim of the page is that some mistakes do not get
	// better by seeing the question again. Letting 算错 into the queue anyway
	// would reshuffle something that was never the problem, and the same
	// mistake would come back looking like a memory failure it never was.
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)
	attemptID := fileMistake(t, router, map[string]any{
		"subject": "math", "stem": "解一元二次方程", "cause": "careless",
	})

	refused := requestJSON(t, router, http.MethodPost, "/api/mistakes/"+attemptID+"/schedule", nil)
	body := refused.Body.String()
	if refused.Code != http.StatusBadRequest {
		t.Fatalf("schedule careless = %d, body = %s", refused.Code, body)
	}
	var failure struct {
		Error string `json:"error"`
	}
	decodeJSON(t, refused, &failure)
	if failure.Error == "" {
		t.Fatalf("no error payload, body = %s", body)
	}

	// And nothing may have leaked into the queue on the way to that refusal.
	due := requestJSON(t, router, http.MethodGet, "/api/reviews/due?limit=20", nil)
	if strings.Contains(due.Body.String(), "解一元二次方程") {
		t.Fatalf("a refused mistake still reached the queue: %s", due.Body.String())
	}
}

func TestMistakeScheduleEndpointDoesNotQueueTheSameQuestionTwice(t *testing.T) {
	// There is no undo in the review queue. The question carries the id of the
	// item it became, so a second press can tell it already did this -- and
	// answers 200, because nothing went wrong: the mistake is already where
	// the caller wants it.
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)
	attemptID := fileMistake(t, router, map[string]any{
		"subject": "physics", "stem": "受力分析的三个步骤", "cause": "recall",
	})

	first := requestJSON(t, router, http.MethodPost, "/api/mistakes/"+attemptID+"/schedule", nil)
	var firstResult struct {
		KnowledgeID string `json:"knowledge_id"`
		PromptCount int    `json:"prompt_count"`
	}
	decodeJSON(t, first, &firstResult)

	second := requestJSON(t, router, http.MethodPost, "/api/mistakes/"+attemptID+"/schedule", nil)
	secondBody := second.Body.String()
	if second.Code != http.StatusOK {
		t.Fatalf("second schedule = %d, body = %s", second.Code, secondBody)
	}
	var secondResult struct {
		Status      string `json:"status"`
		KnowledgeID string `json:"knowledge_id"`
	}
	decodeJSON(t, second, &secondResult)
	if secondResult.Status != "already_scheduled" {
		t.Fatalf("second status = %q, body = %s", secondResult.Status, secondBody)
	}
	if secondResult.KnowledgeID != firstResult.KnowledgeID {
		t.Fatalf("second press named item %q, first made %q", secondResult.KnowledgeID, firstResult.KnowledgeID)
	}

	// Counted by decoding rather than by searching for the stem: the stem is
	// the item's term and the prompt's question both, so a text search reports
	// several hits per card and would pass whatever happened.
	due := requestJSON(t, router, http.MethodGet, "/api/reviews/due?limit=50", nil)
	var queue struct {
		Items []struct {
			Prompt struct {
				KnowledgeItemID string `json:"knowledge_item_id"`
			} `json:"prompt"`
		} `json:"items"`
	}
	decodeJSON(t, due, &queue)
	queued := 0
	for _, entry := range queue.Items {
		if entry.Prompt.KnowledgeItemID == firstResult.KnowledgeID {
			queued++
		}
	}
	if queued != firstResult.PromptCount {
		t.Fatalf("queued %d cards for %d prompts", queued, firstResult.PromptCount)
	}
	if queued == 0 {
		t.Fatal("nothing queued at all")
	}
}

func TestMistakeScheduleEndpointTellsTheListWhichRowsAreDone(t *testing.T) {
	// The page has to stop offering 排进复习 on a row it already scheduled, and
	// it only ever sees the list. A link the list does not carry is one the
	// page cannot act on.
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)
	attemptID := fileMistake(t, router, map[string]any{
		"subject": "geography", "stem": "季风气候的成因", "cause": "recall",
	})
	scheduled := requestJSON(t, router, http.MethodPost, "/api/mistakes/"+attemptID+"/schedule", nil)
	var result struct {
		KnowledgeID string `json:"knowledge_id"`
	}
	decodeJSON(t, scheduled, &result)

	listed := requestJSON(t, router, http.MethodGet, "/api/mistakes?subject=geography", nil)
	listedBody := listed.Body.String()
	var page struct {
		Items []struct {
			Question struct {
				KnowledgeItemID string `json:"knowledge_item_id"`
			} `json:"question"`
		} `json:"items"`
	}
	decodeJSON(t, listed, &page)
	if len(page.Items) != 1 {
		t.Fatalf("items = %#v, body = %s", page.Items, listedBody)
	}
	if page.Items[0].Question.KnowledgeItemID != result.KnowledgeID {
		t.Fatalf("listed link = %q, want %q, body = %s",
			page.Items[0].Question.KnowledgeItemID, result.KnowledgeID, listedBody)
	}
}

func TestMistakeScheduleEndpointRefusesAnAttemptThatWasNeverFiled(t *testing.T) {
	// chi answers 404 for any route it does not know, so a status-only
	// assertion would pass before the endpoint existed.
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)

	missing := requestJSON(t, router, http.MethodPost, "/api/mistakes/never-filed/schedule", nil)
	body := missing.Body.String()
	if missing.Code != http.StatusNotFound {
		t.Fatalf("schedule missing = %d, body = %s", missing.Code, body)
	}
	var failure struct {
		Error string `json:"error"`
	}
	decodeJSON(t, missing, &failure)
	if failure.Error == "" {
		t.Fatalf("expected a JSON error payload, body = %s", body)
	}
}
