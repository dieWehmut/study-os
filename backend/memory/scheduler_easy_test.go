package memory

import (
	"testing"
	"time"

	fsrs "github.com/open-spaced-repetition/go-fsrs/v3"
)

// 「一眼就会」 must actually buy the reader something: fewer future questions.
//
// RatingEasy exists because 认识 (Good) could not distinguish "I recalled it after a moment"
// from "I knew it instantly" (ROADMAP §十), and the difference only matters if it moves the
// next due date. Asserted on the scheduler rather than through HTTP so the claim is exact:
// no wait, no clock, no second call depending on the first one's state.
func TestEasyIsScheduledFurtherOutThanGood(t *testing.T) {
	now := time.Date(2026, 1, 1, 9, 0, 0, 0, time.UTC)

	again := Schedule(fsrs.Card{}, now, RatingAgain)
	hard := Schedule(fsrs.Card{}, now, RatingHard)
	good := Schedule(fsrs.Card{}, now, RatingGood)
	easy := Schedule(fsrs.Card{}, now, RatingEasy)

	// The three that already existed keep their order, so adding a fourth did not disturb them.
	if !hard.Due.After(again.Due) || !good.Due.After(hard.Due) {
		t.Fatalf("the old ladder moved: again=%v hard=%v good=%v", again.Due, hard.Due, good.Due)
	}
	// And 一眼就会 is the new far end -- further out than 认识, not merely equal to it.
	if !easy.Due.After(good.Due) {
		t.Fatalf("easy due %v is not after good due %v: 一眼就会 would not save a single question", easy.Due, good.Due)
	}
}