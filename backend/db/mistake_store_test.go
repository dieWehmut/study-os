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

func TestLinkingAMistakeToTheLibraryIsWhatMakesItAnswerable(t *testing.T) {
	// 想不起来 is the one cause more review actually fixes, but the queue joins
	// review_states through prompts, which hang off a knowledge item. The link
	// on the question is how a second press can tell it already did this --
	// a flag would be a second source of truth that can drift from the item.
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "study.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	filed, err := store.RecordMistake(ctx, models.MistakeInput{Subject: "physics", Stem: "受力分析", Cause: "recall"})
	if err != nil {
		t.Fatalf("record mistake: %v", err)
	}

	fetched, err := store.GetMistake(ctx, filed.Attempt.ID)
	if err != nil {
		t.Fatalf("get mistake: %v", err)
	}
	if fetched.Question.Stem != "受力分析" {
		t.Fatalf("fetched = %#v", fetched)
	}
	if fetched.Question.KnowledgeItemID != "" {
		t.Fatalf("a freshly filed mistake already claims item %q", fetched.Question.KnowledgeItemID)
	}

	if err := store.WithTx(ctx, func(tx *db.TxStore) error {
		return tx.LinkQuestionToKnowledge(ctx, filed.Question.ID, "k-1")
	}); err != nil {
		t.Fatalf("link question: %v", err)
	}

	linked, err := store.GetMistake(ctx, filed.Attempt.ID)
	if err != nil {
		t.Fatalf("get linked mistake: %v", err)
	}
	if linked.Question.KnowledgeItemID != "k-1" {
		t.Fatalf("knowledge item = %q, want k-1", linked.Question.KnowledgeItemID)
	}

	listed, err := store.ListMistakes(ctx, models.MistakeListOptions{Limit: 10})
	if err != nil {
		t.Fatalf("list mistakes: %v", err)
	}
	if len(listed) != 1 || listed[0].Question.KnowledgeItemID != "k-1" {
		t.Fatalf("listed = %#v -- the page cannot hide a done button it cannot see", listed)
	}
}

func TestRecordMistakeCanonicalisesTheCauseItWasGiven(t *testing.T) {
	// The Practice page looks a row's cause up in a closed taxonomy by exact
	// string, and drops any row it cannot name -- so "Recall " stored verbatim
	// is a mistake you filed and can never see again. The queue guard matches
	// exactly for the same reason. One spelling, decided on the way in.
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "study.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	filed, err := store.RecordMistake(ctx, models.MistakeInput{
		Subject: "physics", Stem: "受力分析", Cause: "  Recall ",
	})
	if err != nil {
		t.Fatalf("record mistake: %v", err)
	}
	if filed.Attempt.Cause != "recall" {
		t.Fatalf("cause = %q, want recall", filed.Attempt.Cause)
	}

	listed, err := store.ListMistakes(ctx, models.MistakeListOptions{Limit: 10})
	if err != nil {
		t.Fatalf("list mistakes: %v", err)
	}
	if len(listed) != 1 || listed[0].Attempt.Cause != "recall" {
		t.Fatalf("listed = %#v", listed)
	}
}

func TestGetMistakeReportsAnIDThatWasNeverFiled(t *testing.T) {
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "study.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	if _, err := store.GetMistake(ctx, "never-filed"); !errors.Is(err, db.ErrNotFound) {
		t.Fatalf("get unknown = %v, want ErrNotFound", err)
	}
}

func TestCorrectingAMistakeMarksItWithoutTakingItOffTheList(t *testing.T) {
	// A 错题本 that only ever grows is one you stop opening. 订正 has to be
	// visible on the row -- and the row has to stay, because "I got this wrong
	// once and fixed it" is the sentence the log exists to be able to say.
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "study.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	filed, err := store.RecordMistake(ctx, models.MistakeInput{
		Subject: "physics", Stem: "求到底端的速度。", Cause: "method",
	})
	if err != nil {
		t.Fatalf("record mistake: %v", err)
	}
	if filed.Corrected {
		t.Fatalf("a mistake is not corrected the moment it is filed: %#v", filed)
	}

	corrected, err := store.CorrectMistake(ctx, filed.Attempt.ID)
	if err != nil {
		t.Fatalf("correct mistake: %v", err)
	}
	if !corrected.Corrected {
		t.Fatalf("corrected = %#v", corrected)
	}

	listed, err := store.ListMistakes(ctx, models.MistakeListOptions{Limit: 10})
	if err != nil {
		t.Fatalf("list mistakes: %v", err)
	}
	// Exactly one row: the retry is a second attempt on the same question, and
	// a right answer is not a mistake to list.
	if len(listed) != 1 {
		t.Fatalf("listed = %#v", listed)
	}
	if listed[0].Attempt.ID != filed.Attempt.ID || !listed[0].Corrected {
		t.Fatalf("listed[0] = %#v", listed[0])
	}
}

func TestCorrectingAMistakeTwiceSaysTheSameThing(t *testing.T) {
	// The button is on a page that reloads, and a double press must not file
	// two retries -- "how many times did I get this wrong" counts causes, and
	// a second empty-cause row would be a second thing to explain.
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "study.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	filed, err := store.RecordMistake(ctx, models.MistakeInput{
		Subject: "chemistry", Stem: "判断过量。", Cause: "recall",
	})
	if err != nil {
		t.Fatalf("record mistake: %v", err)
	}
	for round := range 2 {
		corrected, err := store.CorrectMistake(ctx, filed.Attempt.ID)
		if err != nil {
			t.Fatalf("correct mistake, round %d: %v", round, err)
		}
		if !corrected.Corrected {
			t.Fatalf("round %d: corrected = %#v", round, corrected)
		}
	}

	var attempts int
	if err := store.SQL().QueryRowContext(ctx,
		`SELECT COUNT(*) FROM question_attempts WHERE question_id = ?`, filed.Question.ID,
	).Scan(&attempts); err != nil {
		t.Fatalf("count attempts: %v", err)
	}
	if attempts != 2 {
		t.Fatalf("attempts = %d, want the mistake and one retry", attempts)
	}
}

func TestCorrectMistakeReportsAnIDThatWasNeverFiled(t *testing.T) {
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "study.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	if _, err := store.CorrectMistake(ctx, "never-filed"); !errors.Is(err, db.ErrNotFound) {
		t.Fatalf("correct unknown = %v, want ErrNotFound", err)
	}
}

func TestDeletingACorrectedMistakeLeavesNoQuestionBehind(t *testing.T) {
	// 取消 on a corrected row used to leave the question alive, held up by the
	// retry alone: the list join is inner and filters causeless attempts out,
	// so that question became a row nothing could see and nothing could
	// delete. A question is spent once no attempt still blames anything.
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "study.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	filed, err := store.RecordMistake(ctx, models.MistakeInput{
		Subject: "math", Stem: "求导。", Cause: "careless",
	})
	if err != nil {
		t.Fatalf("record mistake: %v", err)
	}
	if _, err := store.CorrectMistake(ctx, filed.Attempt.ID); err != nil {
		t.Fatalf("correct mistake: %v", err)
	}
	if err := store.DeleteMistake(ctx, filed.Attempt.ID); err != nil {
		t.Fatalf("delete mistake: %v", err)
	}

	var questions, attempts int
	if err := store.SQL().QueryRowContext(ctx,
		`SELECT COUNT(*) FROM questions WHERE id = ?`, filed.Question.ID).Scan(&questions); err != nil {
		t.Fatalf("count questions: %v", err)
	}
	if err := store.SQL().QueryRowContext(ctx,
		`SELECT COUNT(*) FROM question_attempts WHERE question_id = ?`, filed.Question.ID).Scan(&attempts); err != nil {
		t.Fatalf("count attempts: %v", err)
	}
	if questions != 0 || attempts != 0 {
		t.Fatalf("questions = %d, attempts = %d, want both gone", questions, attempts)
	}
}
