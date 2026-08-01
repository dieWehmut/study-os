package memory

import "testing"

func TestEvaluateAnswer(t *testing.T) {
	tests := []struct {
		name     string
		answer   string
		answers  []string
		want     Outcome
		wantRate Rating
	}{
		{name: "correct normalized answer", answer: " 放弃。 ", answers: []string{"放弃", "抛弃"}, want: OutcomeCorrect, wantRate: RatingGood},
		{name: "partial multi-part answer", answer: "放弃", answers: []string{"放弃;抛弃"}, want: OutcomePartial, wantRate: RatingHard},
		{name: "incorrect answer", answer: "坚持", answers: []string{"放弃", "抛弃"}, want: OutcomeIncorrect, wantRate: RatingAgain},
		{name: "empty answer", answer: "  ", answers: []string{"abandon"}, want: OutcomeIncorrect, wantRate: RatingAgain},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := EvaluateAnswer(tt.answer, tt.answers)
			if got.Outcome != tt.want || got.Rating != tt.wantRate {
				t.Fatalf("EvaluateAnswer() = %#v", got)
			}
			if got.Feedback == "" {
				t.Fatal("feedback is empty")
			}
		})
	}
}

func TestEvaluateAnswerAcceptsEnglishCaseAndPunctuation(t *testing.T) {
	got := EvaluateAnswer(" Abandon! ", []string{"abandon"})
	if got.Outcome != OutcomeCorrect {
		t.Fatalf("outcome = %q", got.Outcome)
	}
}
