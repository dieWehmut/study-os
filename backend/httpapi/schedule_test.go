package httpapi_test

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"study-os/backend/config"
	"study-os/backend/httpapi"
	"study-os/backend/models"
)

func TestScheduleEndpointPutsAFiledItemIntoTheReviewQueue(t *testing.T) {
	// 收进知识库 writes an item and stops. The due query joins review_states, so
	// an item with no prompts can never appear in it -- everything 预习 produces
	// would sit in the library forever without this.
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)
	dumped := requestJSON(t, router, http.MethodPost, "/api/dump", map[string]any{
		"text": "动能定理 / 适用条件\n只对合外力做功成立。",
	})
	if dumped.Code != http.StatusCreated {
		t.Fatalf("dump = %d, body = %s", dumped.Code, dumped.Body.String())
	}
	var created struct {
		ID string `json:"id"`
	}
	decodeJSON(t, dumped, &created)

	scheduled := requestJSON(t, router, http.MethodPost, "/api/knowledge/"+created.ID+"/schedule", nil)
	if scheduled.Code != http.StatusCreated {
		t.Fatalf("schedule = %d, body = %s", scheduled.Code, scheduled.Body.String())
	}

	due := requestJSON(t, router, http.MethodGet, "/api/reviews/due?limit=20", nil)
	if due.Code != http.StatusOK || !strings.Contains(due.Body.String(), "动能定理") {
		t.Fatalf("due = %d, body = %s", due.Code, due.Body.String())
	}
}

func TestScheduleEndpointDoesNotQueueTheSameItemTwice(t *testing.T) {
	// There is no undo in the review queue, so a second click must not hand you
	// the same card twice for the rest of the item's life.
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)
	dumped := requestJSON(t, router, http.MethodPost, "/api/dump", map[string]any{"text": "光合作用的两个阶段"})
	var created struct {
		ID string `json:"id"`
	}
	decodeJSON(t, dumped, &created)

	first := requestJSON(t, router, http.MethodPost, "/api/knowledge/"+created.ID+"/schedule", nil)
	var firstBody struct {
		PromptCount int `json:"prompt_count"`
	}
	decodeJSON(t, first, &firstBody)

	second := requestJSON(t, router, http.MethodPost, "/api/knowledge/"+created.ID+"/schedule", nil)
	if second.Code != http.StatusOK {
		t.Fatalf("second schedule = %d, body = %s", second.Code, second.Body.String())
	}
	if !strings.Contains(second.Body.String(), "already_scheduled") {
		t.Fatalf("second schedule body = %s", second.Body.String())
	}

	// Counted by decoding rather than by searching the body for the item id:
	// the generated prompt ids contain the item id as a substring, so a text
	// search reports three hits per card and would pass whatever happened.
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
		if entry.Prompt.KnowledgeItemID == created.ID {
			queued++
		}
	}
	if queued != firstBody.PromptCount {
		t.Fatalf("queued %d cards for %d prompts, body = %s", queued, firstBody.PromptCount, due.Body.String())
	}
	if queued == 0 {
		t.Fatalf("nothing queued at all, body = %s", due.Body.String())
	}
}

func TestScheduleEndpointRefusesAnItemThatIsNotThere(t *testing.T) {
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)

	response := requestJSON(t, router, http.MethodPost, "/api/knowledge/nope/schedule", nil)

	if response.Code != http.StatusNotFound {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	// The router answers 404 for any address it does not recognise, so the
	// status alone cannot tell "no such item" from "no such endpoint". The
	// error payload is what says the request reached the handler at all.
	var failure struct {
		Error string `json:"error"`
	}
	decodeJSON(t, response, &failure)
	if failure.Error == "" {
		t.Fatalf("no error payload, body = %s", response.Body.String())
	}
}

func TestScheduleEndpointAsksTheItemsOwnSubjectForItsPrompts(t *testing.T) {
	// The prompts are built from the item's own words, not from a model. An
	// English word and a physics conclusion are not usefully checked the same
	// way, and the generator already knows the difference.
	application := testApplication(t, config.Config{})
	now := time.Date(2026, 8, 8, 12, 0, 0, 0, time.UTC)
	if err := application.Store.CreateKnowledgeItem(context.Background(), models.KnowledgeItem{
		ID: "k-schedule-en", ItemType: "word_sense", Term: "abandon", ConciseDefinition: "放弃；抛弃",
		Subject: "english", CreatedAt: now, UpdatedAt: now,
	}); err != nil {
		t.Fatalf("create item: %v", err)
	}
	router := httpapi.NewRouter(application)

	requestJSON(t, router, http.MethodPost, "/api/knowledge/k-schedule-en/schedule", nil)

	due := requestJSON(t, router, http.MethodGet, "/api/reviews/due?limit=20", nil)
	if !strings.Contains(due.Body.String(), "en_to_zh") {
		t.Fatalf("due = %s", due.Body.String())
	}
}
