package db_test

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"study-os/backend/db"
	"study-os/backend/models"
)

// 复习作答次数 is one of the three numbers 第 4 阶段 waits for. It has to be readable
// outside the dashboard handler, and it has to be the *review* count: the practice log
// lives in `question_attempts`, and a gate that quietly counted those instead would
// look answered while answering a different question.
func TestCountReviewAttemptsIsTheReviewTableNotThePracticeOne(t *testing.T) {
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "study.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	total, err := store.CountReviewAttempts(ctx)
	if err != nil {
		t.Fatalf("count on a fresh store: %v", err)
	}
	if total != 0 {
		t.Fatalf("fresh store counts %d review attempts, want 0", total)
	}

	// A filed mistake is practice, not review: it must not move this number.
	if _, err := store.RecordMistake(ctx, models.MistakeInput{
		Subject: "math", Stem: "探针题", Cause: "method",
		OccurredAt: time.Date(2026, 8, 22, 9, 0, 0, 0, time.UTC),
	}); err != nil {
		t.Fatalf("record mistake: %v", err)
	}
	after, err := store.CountReviewAttempts(ctx)
	if err != nil {
		t.Fatalf("count after a practice attempt: %v", err)
	}
	if after != 0 {
		t.Fatalf("practice attempt moved the review count to %d", after)
	}
}
