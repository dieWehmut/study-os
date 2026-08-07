package httpapi

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
	"time"

	_ "modernc.org/sqlite"
)

// streakTestDB builds only the tables currentReviewStreak reads, so the test
// stays readable and independent of unrelated schema changes.
func streakTestDB(t *testing.T) *sql.DB {
	t.Helper()
	database, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "streak.db"))
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	t.Cleanup(func() { _ = database.Close() })
	if _, err := database.Exec(`
		CREATE TABLE knowledge_items(id TEXT PRIMARY KEY, subject TEXT NOT NULL);
		CREATE TABLE prompts(id TEXT PRIMARY KEY, knowledge_item_id TEXT NOT NULL);
		CREATE TABLE attempts(id TEXT PRIMARY KEY, prompt_id TEXT NOT NULL, created_at TEXT NOT NULL);
	`); err != nil {
		t.Fatalf("create schema: %v", err)
	}
	return database
}

// addAttempt records one attempt for the given subject on the given day.
func addAttempt(t *testing.T, database *sql.DB, id, subject string, at time.Time) {
	t.Helper()
	knowledgeID := "k-" + subject
	promptID := "p-" + subject
	if _, err := database.Exec(`INSERT OR IGNORE INTO knowledge_items(id, subject) VALUES(?, ?)`, knowledgeID, subject); err != nil {
		t.Fatalf("insert knowledge item: %v", err)
	}
	if _, err := database.Exec(`INSERT OR IGNORE INTO prompts(id, knowledge_item_id) VALUES(?, ?)`, promptID, knowledgeID); err != nil {
		t.Fatalf("insert prompt: %v", err)
	}
	if _, err := database.Exec(`INSERT INTO attempts(id, prompt_id, created_at) VALUES(?, ?, ?)`, id, promptID, formatHTTPTime(at)); err != nil {
		t.Fatalf("insert attempt: %v", err)
	}
}

func TestCurrentReviewStreak(t *testing.T) {
	now := time.Date(2026, 8, 7, 15, 30, 0, 0, time.UTC)
	day := func(offset int) time.Time { return now.AddDate(0, 0, offset) }

	tests := []struct {
		name    string
		offsets []int
		want    int
	}{
		{name: "no attempts", offsets: nil, want: 0},
		{name: "only today", offsets: []int{0}, want: 1},
		{name: "only yesterday keeps today pending", offsets: []int{-1}, want: 1},
		{name: "three consecutive days", offsets: []int{0, -1, -2}, want: 3},
		{name: "gap stops the streak", offsets: []int{0, -1, -3, -4}, want: 2},
		{name: "stale history is not a streak", offsets: []int{-5, -6}, want: 0},
		{name: "repeat attempts on one day count once", offsets: []int{0, 0, -1}, want: 2},
	}

	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			database := streakTestDB(t)
			for index, offset := range testCase.offsets {
				addAttempt(t, database, string(rune('a'+index)), "english", day(offset))
			}
			got, err := currentReviewStreak(context.Background(), database, "", now)
			if err != nil {
				t.Fatalf("currentReviewStreak: %v", err)
			}
			if got != testCase.want {
				t.Fatalf("streak = %d, want %d", got, testCase.want)
			}
		})
	}
}

func TestCurrentReviewStreakScopesToSubject(t *testing.T) {
	now := time.Date(2026, 8, 7, 9, 0, 0, 0, time.UTC)
	database := streakTestDB(t)
	addAttempt(t, database, "e1", "english", now)
	addAttempt(t, database, "e2", "english", now.AddDate(0, 0, -1))
	addAttempt(t, database, "p1", "physics", now)

	english, err := currentReviewStreak(context.Background(), database, "english", now)
	if err != nil {
		t.Fatalf("english streak: %v", err)
	}
	if english != 2 {
		t.Fatalf("english streak = %d, want 2", english)
	}

	physics, err := currentReviewStreak(context.Background(), database, "physics", now)
	if err != nil {
		t.Fatalf("physics streak: %v", err)
	}
	if physics != 1 {
		t.Fatalf("physics streak = %d, want 1", physics)
	}
}
