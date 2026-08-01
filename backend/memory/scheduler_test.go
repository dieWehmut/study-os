package memory

import (
	"testing"
	"time"

	fsrs "github.com/open-spaced-repetition/go-fsrs/v3"
)

func TestScheduleMapsOutcomesToSupportedRatings(t *testing.T) {
	now := time.Date(2026, 8, 1, 10, 0, 0, 0, time.UTC)
	card := fsrs.NewCard()

	again := Schedule(card, now, RatingAgain)
	hard := Schedule(card, now, RatingHard)
	good := Schedule(card, now, RatingGood)

	if !again.Due.Before(hard.Due) {
		t.Fatalf("Again due %s should be before Hard due %s", again.Due, hard.Due)
	}
	if good.Reps != 1 || hard.Reps != 1 || again.Reps != 1 {
		t.Fatalf("review was not applied: %#v %#v %#v", again, hard, good)
	}
}

func TestOverrideRecomputesFromPreReviewCard(t *testing.T) {
	now := time.Date(2026, 8, 1, 10, 0, 0, 0, time.UTC)
	before := fsrs.NewCard()
	original := Schedule(before, now, RatingAgain)

	overridden := OverrideSchedule(before, now, original, RatingGood)
	want := Schedule(before, now, RatingGood)

	if !overridden.Due.Equal(want.Due) || overridden.Difficulty != want.Difficulty || overridden.Stability != want.Stability {
		t.Fatalf("override %#v was not recomputed from snapshot; want %#v", overridden, want)
	}
	if overridden.Due.Equal(original.Due) {
		t.Fatal("override retained original schedule")
	}
}
