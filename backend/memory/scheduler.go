package memory

import (
	"time"

	fsrs "github.com/open-spaced-repetition/go-fsrs/v3"
)

func Schedule(card fsrs.Card, now time.Time, rating Rating) fsrs.Card {
	fsrsRating := toFSRSRating(rating)
	return fsrs.NewFSRS(fsrs.DefaultParam()).Next(card, now.UTC(), fsrsRating).Card
}

func OverrideSchedule(before fsrs.Card, now time.Time, _ fsrs.Card, rating Rating) fsrs.Card {
	return Schedule(before, now, rating)
}

func toFSRSRating(rating Rating) fsrs.Rating {
	switch rating {
	case RatingHard:
		return fsrs.Hard
	case RatingGood:
		return fsrs.Good
	default:
		return fsrs.Again
	}
}
