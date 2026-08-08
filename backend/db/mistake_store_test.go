package db_test

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"study-os/backend/db"
	"study-os/backend/models"
)

func TestRecordMistakeStoresQuestionAndAttempt(t *testing.T) {
	// The Practice page's mistake log lived in localStorage, where nothing else
	// in the system could join against it. A recorded mistake has to come back
	// as a row -- question and attempt separately, because the same question
	// gets attempted again after 订正.
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "study.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	now := time.Date(2026, 8, 8, 9, 0, 0, 0, time.UTC)
	recorded, err := store.RecordMistake(ctx, models.MistakeInput{
		Subject:  "physics",
		Stem:     "小球从斜面顶端滑下，求到底端的速度。",
		Cause:    "method",
		Note:     "忘了摩擦力做负功",
		OccurredAt: now,
	})
	if err != nil {
		t.Fatalf("record mistake: %v", err)
	}
	if recorded.Question.ID == "" || recorded.Attempt.ID == "" {
		t.Fatalf("recorded = %#v", recorded)
	}
	if recorded.Attempt.QuestionID != recorded.Question.ID {
		t.Fatalf("attempt points at %q, question is %q", recorded.Attempt.QuestionID, recorded.Question.ID)
	}

	mistakes, err := store.ListMistakes(ctx, models.MistakeListOptions{Subject: "physics", Limit: 10})
	if err != nil {
		t.Fatalf("list mistakes: %v", err)
	}
	if len(mistakes) != 1 {
		t.Fatalf("mistakes = %#v", mistakes)
	}
	if mistakes[0].Question.Stem != "小球从斜面顶端滑下，求到底端的速度。" {
		t.Fatalf("stem = %q", mistakes[0].Question.Stem)
	}
	if mistakes[0].Attempt.Cause != "method" || mistakes[0].Attempt.Note != "忘了摩擦力做负功" {
		t.Fatalf("attempt = %#v", mistakes[0].Attempt)
	}
}

func TestListMistakesLeavesOtherSubjectsAlone(t *testing.T) {
	// 首页 switches subject, and every list in the app narrows with it. A
	// mistake log that ignored the switch would show 地理 errors while you are
	// working through 物理.
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "study.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	for _, filed := range []models.MistakeInput{
		{Subject: "physics", Stem: "受力分析", Cause: "method"},
		{Subject: "geography", Stem: "城市化对水循环的影响", Cause: "recall"},
	} {
		if _, err := store.RecordMistake(ctx, filed); err != nil {
			t.Fatalf("record %s: %v", filed.Subject, err)
		}
	}

	mistakes, err := store.ListMistakes(ctx, models.MistakeListOptions{Subject: "geography", Limit: 10})
	if err != nil {
		t.Fatalf("list mistakes: %v", err)
	}
	if len(mistakes) != 1 || mistakes[0].Question.Subject != "geography" {
		t.Fatalf("mistakes = %#v", mistakes)
	}

	all, err := store.ListMistakes(ctx, models.MistakeListOptions{Limit: 10})
	if err != nil {
		t.Fatalf("list all: %v", err)
	}
	if len(all) != 2 {
		t.Fatalf("all = %#v", all)
	}
}

func TestRecordMistakeRejectsAnEmptyStem(t *testing.T) {
	// A row with no question text is a row you can never act on: it cannot be
	// re-attempted, classified, or matched to a knowledge point.
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "study.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	if _, err := store.RecordMistake(ctx, models.MistakeInput{Subject: "math", Stem: "   "}); err == nil {
		t.Fatal("expected an empty stem to be refused")
	}
}

func TestDeleteMistakeTakesTheQuestionWithItWhenNothingElsePointsAtIt(t *testing.T) {
	// The join to questions is an inner one, so an orphaned question is
	// invisible -- and therefore permanent. Rows nobody can see and nobody can
	// delete are how a store quietly fills up.
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "study.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	filed, err := store.RecordMistake(ctx, models.MistakeInput{Subject: "physics", Stem: "受力分析", Cause: "careless"})
	if err != nil {
		t.Fatalf("record mistake: %v", err)
	}
	if err := store.DeleteMistake(ctx, filed.Attempt.ID); err != nil {
		t.Fatalf("delete mistake: %v", err)
	}

	var questions int
	if err := store.SQL().QueryRowContext(ctx, `SELECT COUNT(*) FROM questions`).Scan(&questions); err != nil {
		t.Fatalf("count questions: %v", err)
	}
	if questions != 0 {
		t.Fatalf("questions left behind = %d", questions)
	}
}

func TestDeleteMistakeReportsAnIDThatWasNeverFiled(t *testing.T) {
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "study.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	if err := store.DeleteMistake(ctx, "never-filed"); !errors.Is(err, db.ErrNotFound) {
		t.Fatalf("delete unknown = %v, want ErrNotFound", err)
	}
}
