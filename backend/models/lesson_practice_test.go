package models

import "testing"

func TestLessonPracticeAttemptValidation(t *testing.T) {
	valid := LessonPracticeAttempt{
		ID: "attempt-1", LessonID: "lesson-1", SectionID: "practice", Answer: "A",
		Evaluation: LessonPracticeEvaluationCorrect, ElapsedMS: 0,
	}
	if err := valid.Validate(); err != nil {
		t.Fatalf("valid attempt rejected: %v", err)
	}
	cases := []struct {
		name string
		item LessonPracticeAttempt
	}{
		{name: "id", item: LessonPracticeAttempt{LessonID: "l", SectionID: "s", Answer: "a", Evaluation: LessonPracticeEvaluationUngraded}},
		{name: "lesson", item: LessonPracticeAttempt{ID: "a", SectionID: "s", Answer: "a", Evaluation: LessonPracticeEvaluationUngraded}},
		{name: "section", item: LessonPracticeAttempt{ID: "a", LessonID: "l", Answer: "a", Evaluation: LessonPracticeEvaluationUngraded}},
		{name: "answer", item: LessonPracticeAttempt{ID: "a", LessonID: "l", SectionID: "s", Evaluation: LessonPracticeEvaluationUngraded}},
		{name: "evaluation", item: LessonPracticeAttempt{ID: "a", LessonID: "l", SectionID: "s", Answer: "a", Evaluation: "pending"}},
		{name: "elapsed", item: LessonPracticeAttempt{ID: "a", LessonID: "l", SectionID: "s", Answer: "a", Evaluation: LessonPracticeEvaluationUngraded, ElapsedMS: -1}},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if err := testCase.item.Validate(); err == nil {
				t.Fatalf("expected validation error")
			}
		})
	}
}
