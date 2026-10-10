package models

import (
	"encoding/json"
	"strings"
	"testing"
)

// The store refuses documents that would break later, and only those: a practice
// section that still uses the flat single-question fields is the older shape, not
// a mistake.
func TestNormalizeLessonDocumentChecksPracticeQuestions(t *testing.T) {
	documentWithPractice := func(content string) LessonDocument {
		document := NewLessonDocument()
		for index := range document.Sections {
			if document.Sections[index].Type == "practice" {
				document.Sections[index].Content = json.RawMessage(content)
			}
		}
		return document
	}

	for _, testCase := range []struct {
		name    string
		content string
		wantErr string
	}{
		{name: "flat single question", content: `{"question":"速度单位?","options":["m/s","N"],"correct_answer":"m/s"}`},
		{name: "empty content", content: `{}`},
		{name: "legacy text", content: `"先画受力图"`},
		{name: "two questions", content: `{"questions":[{"id":"q1","question":"a?"},{"id":"q2","question":"b?"}]}`},
		{name: "questions without ids", content: `{"questions":[{"question":"a?"},{"question":"b?"}]}`},
		{
			name:    "too many",
			content: `{"questions":[` + strings.Repeat(`{"question":"a?"},`, MaxLessonPracticeQuestions) + `{"question":"last?"}]}`,
			wantErr: "at most 20",
		},
		{name: "duplicate id", content: `{"questions":[{"id":"q1","question":"a?"},{"id":"q1","question":"b?"}]}`, wantErr: "appears twice"},
		{name: "question without text", content: `{"questions":[{"id":"q1","options":["a"]}]}`, wantErr: "has no text"},
		{name: "questions not a list", content: `{"questions":"q1"}`, wantErr: "must be a list"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			_, err := NormalizeLessonDocument(documentWithPractice(testCase.content))
			if testCase.wantErr == "" {
				if err != nil {
					t.Fatalf("document rejected: %v", err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), testCase.wantErr) {
				t.Fatalf("error = %v, want substring %q", err, testCase.wantErr)
			}
		})
	}
}

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
