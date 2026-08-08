package httpapi_test

import (
	"net/http"
	"testing"
	"time"

	"study-os/backend/config"
	"study-os/backend/httpapi"
)

type forecastBody struct {
	Days []struct {
		Date  string `json:"date"`
		Count int    `json:"count"`
	} `json:"days"`
	Horizon int `json:"horizon"`
}

func getForecast(t *testing.T, router http.Handler, query string) forecastBody {
	t.Helper()
	response := requestJSON(t, router, http.MethodGet, "/api/reviews/forecast"+query, nil)
	raw := response.Body.String()
	if response.Code != http.StatusOK {
		t.Fatalf("forecast%s = %d, body = %s", query, response.Code, raw)
	}
	var body forecastBody
	decodeJSON(t, response, &body)
	return body
}

func TestReviewForecastEndpointReturnsOneEntryPerDayOfTheHorizon(t *testing.T) {
	// A single 待复习 number cannot show a pile-up. FSRS spreads work forward,
	// so two skipped days are invisible until Monday hands you ninety cards.
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)

	body := getForecast(t, router, "?days=5")

	if len(body.Days) != 5 {
		t.Fatalf("want 5 days, got %d: %+v", len(body.Days), body.Days)
	}
	if body.Horizon != 5 {
		t.Errorf("horizon = %d, want 5", body.Horizon)
	}
	// Today first, then forward, each day one calendar step from the last.
	today := time.Now().Format("2006-01-02")
	if body.Days[0].Date != today {
		t.Errorf("first day = %q, want today %q", body.Days[0].Date, today)
	}
	for i := 1; i < len(body.Days); i++ {
		previous, err := time.Parse("2006-01-02", body.Days[i-1].Date)
		if err != nil {
			t.Fatalf("parse %q: %v", body.Days[i-1].Date, err)
		}
		if want := previous.AddDate(0, 0, 1).Format("2006-01-02"); body.Days[i].Date != want {
			t.Errorf("day %d = %q, want %q", i, body.Days[i].Date, want)
		}
	}
}

func TestReviewForecastEndpointCountsACardScheduledToday(t *testing.T) {
	// The one thing the panel must never do is disagree with the queue standing
	// right beside it. Both are read from review_states, and this is the test
	// that keeps them reading the same rows.
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)
	attemptID := fileMistake(t, router, map[string]any{
		"subject": "physics",
		"stem":    "小球从斜面顶端滑下，求到底端的速度。",
		"cause":   "recall",
	})
	scheduled := requestJSON(t, router, http.MethodPost, "/api/mistakes/"+attemptID+"/schedule", nil)
	if scheduled.Code != http.StatusCreated {
		t.Fatalf("schedule = %d, body = %s", scheduled.Code, scheduled.Body.String())
	}

	body := getForecast(t, router, "?days=7")

	if body.Days[0].Count == 0 {
		t.Fatalf("today counts %d cards, want the one just scheduled: %+v", body.Days[0].Count, body.Days)
	}
}

func TestReviewForecastEndpointCountsOnlyTheSubjectAsked(t *testing.T) {
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)
	attemptID := fileMistake(t, router, map[string]any{
		"subject": "physics",
		"stem":    "小球从斜面顶端滑下，求到底端的速度。",
		"cause":   "recall",
	})
	if scheduled := requestJSON(t, router, http.MethodPost, "/api/mistakes/"+attemptID+"/schedule", nil); scheduled.Code != http.StatusCreated {
		t.Fatalf("schedule = %d, body = %s", scheduled.Code, scheduled.Body.String())
	}

	physics := getForecast(t, router, "?days=7&subject=physics")
	chemistry := getForecast(t, router, "?days=7&subject=chemistry")

	if physics.Days[0].Count == 0 {
		t.Errorf("物理 today = 0, want the scheduled card")
	}
	if chemistry.Days[0].Count != 0 {
		t.Errorf("化学 today = %d, want 0", chemistry.Days[0].Count)
	}
}

func TestReviewForecastEndpointClampsAnAbsurdHorizon(t *testing.T) {
	// days arrives from a query string. A blank must still draw a panel, and a
	// huge one must not walk the whole card table for a chart nobody can read.
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)

	if blank := getForecast(t, router, ""); len(blank.Days) == 0 {
		t.Error("no days without an explicit horizon")
	}
	if junk := getForecast(t, router, "?days=abc"); len(junk.Days) == 0 {
		t.Error("no days for an unparseable horizon")
	}
	if huge := getForecast(t, router, "?days=5000"); len(huge.Days) > 30 {
		t.Errorf("days=5000 produced %d days, want it clamped", len(huge.Days))
	}
}
