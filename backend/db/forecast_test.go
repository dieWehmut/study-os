package db_test

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"study-os/backend/db"
	"study-os/backend/models"

	_ "modernc.org/sqlite"
)

// The learner's clock is the server's clock -- this runs on their own machine --
// so a day boundary is local midnight, and the fixtures say so.
var forecastNow = time.Date(2026, 8, 9, 21, 30, 0, 0, time.Local)

func forecastStore(t *testing.T) (*db.Store, context.Context) {
	t.Helper()
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "study.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store, ctx
}

// scheduleCard files one knowledge item, one prompt, and one review state due
// at the given moment. All three are needed: a review state hangs off a prompt,
// and a prompt off an item, so a forecast built on review states alone would
// count rows the queue can never actually serve.
func scheduleCard(t *testing.T, ctx context.Context, store *db.Store, id, subject string, due time.Time) {
	t.Helper()
	if err := store.CreateKnowledgeItem(ctx, models.KnowledgeItem{
		ID:                "k-" + id,
		ItemType:          "word_sense",
		Term:              id,
		Subject:           subject,
		ConciseDefinition: "释义",
		CreatedAt:         forecastNow,
		UpdatedAt:         forecastNow,
	}); err != nil {
		t.Fatalf("create knowledge item %s: %v", id, err)
	}
	if err := store.CreatePrompt(ctx, models.Prompt{
		ID:              "p-" + id,
		KnowledgeItemID: "k-" + id,
		PromptType:      "en_to_zh",
		Question:        id,
		AcceptedAnswers: []string{"释义"},
		CreatedAt:       forecastNow,
		UpdatedAt:       forecastNow,
	}); err != nil {
		t.Fatalf("create prompt %s: %v", id, err)
	}
	if err := store.UpsertReviewState(ctx, models.ReviewState{
		PromptID:  "p-" + id,
		CardJSON:  []byte(`{"stability":1}`),
		DueAt:     due,
		UpdatedAt: forecastNow,
	}); err != nil {
		t.Fatalf("upsert review state %s: %v", id, err)
	}
}

func TestReviewForecastCountsEachDayOfTheHorizon(t *testing.T) {
	store, ctx := forecastStore(t)

	// Two tomorrow, one the day after, one beyond the horizon.
	scheduleCard(t, ctx, store, "a", "english", forecastNow.AddDate(0, 0, 1))
	scheduleCard(t, ctx, store, "b", "english", forecastNow.AddDate(0, 0, 1).Add(2*time.Hour))
	scheduleCard(t, ctx, store, "c", "english", forecastNow.AddDate(0, 0, 2))
	scheduleCard(t, ctx, store, "d", "english", forecastNow.AddDate(0, 0, 30))

	days, err := store.ReviewForecast(ctx, forecastNow, 3, "")
	if err != nil {
		t.Fatalf("review forecast: %v", err)
	}
	if len(days) != 3 {
		t.Fatalf("want 3 days, got %d: %+v", len(days), days)
	}
	wantDates := []string{"2026-08-09", "2026-08-10", "2026-08-11"}
	wantCounts := []int{0, 2, 1}
	for i, day := range days {
		if day.Date != wantDates[i] {
			t.Errorf("day %d date = %q, want %q", i, day.Date, wantDates[i])
		}
		if day.Count != wantCounts[i] {
			t.Errorf("day %d (%s) count = %d, want %d", i, day.Date, day.Count, wantCounts[i])
		}
	}
}

func TestReviewForecastFoldsOverdueIntoToday(t *testing.T) {
	// A card three days late is due now, not three days ago. Giving 逾期 its own
	// bucket invites planning around it, which is how a backlog becomes
	// permanent -- today's column is the honest number.
	store, ctx := forecastStore(t)
	scheduleCard(t, ctx, store, "late", "english", forecastNow.AddDate(0, 0, -3))
	scheduleCard(t, ctx, store, "now", "english", forecastNow.Add(-time.Hour))

	days, err := store.ReviewForecast(ctx, forecastNow, 2, "")
	if err != nil {
		t.Fatalf("review forecast: %v", err)
	}
	if days[0].Count != 2 {
		t.Fatalf("today = %d, want 2 (both the overdue card and the one due this hour)", days[0].Count)
	}
}

func TestReviewForecastCountsOnlyTheSubjectAsked(t *testing.T) {
	store, ctx := forecastStore(t)
	scheduleCard(t, ctx, store, "en", "english", forecastNow.AddDate(0, 0, 1))
	scheduleCard(t, ctx, store, "phy", "physics", forecastNow.AddDate(0, 0, 1))

	days, err := store.ReviewForecast(ctx, forecastNow, 2, "physics")
	if err != nil {
		t.Fatalf("review forecast: %v", err)
	}
	if days[1].Count != 1 {
		t.Fatalf("tomorrow for 物理 = %d, want 1", days[1].Count)
	}
}

func TestReviewForecastReturnsAnEmptyDayRatherThanSkippingIt(t *testing.T) {
	// A day with nothing due is the most informative day on the chart -- it is
	// where you can afford to add cards. Dropping it would leave the reader to
	// infer gaps from date arithmetic.
	store, ctx := forecastStore(t)
	scheduleCard(t, ctx, store, "far", "english", forecastNow.AddDate(0, 0, 3))

	days, err := store.ReviewForecast(ctx, forecastNow, 4, "")
	if err != nil {
		t.Fatalf("review forecast: %v", err)
	}
	if len(days) != 4 {
		t.Fatalf("want 4 days, got %d", len(days))
	}
	for i := range 3 {
		if days[i].Count != 0 {
			t.Errorf("day %d (%s) = %d, want 0", i, days[i].Date, days[i].Count)
		}
	}
	if days[3].Count != 1 {
		t.Errorf("day 3 = %d, want 1", days[3].Count)
	}
}

func TestReviewForecastClampsTheHorizon(t *testing.T) {
	// The horizon arrives from a query string. A zero would render an empty
	// panel and a huge one would walk the whole card table for a chart nobody
	// can read.
	store, ctx := forecastStore(t)

	for _, span := range []int{0, -1} {
		days, err := store.ReviewForecast(ctx, forecastNow, span, "")
		if err != nil {
			t.Fatalf("review forecast(%d): %v", span, err)
		}
		if len(days) == 0 {
			t.Errorf("horizon %d produced no days", span)
		}
	}

	days, err := store.ReviewForecast(ctx, forecastNow, 5000, "")
	if err != nil {
		t.Fatalf("review forecast(5000): %v", err)
	}
	if len(days) > 90 {
		t.Errorf("horizon 5000 produced %d days, want it clamped", len(days))
	}
}
