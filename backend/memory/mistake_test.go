package memory_test

import (
	"strings"
	"testing"

	"study-os/backend/memory"
)

func TestOnlyForgettingIsWhatMoreReviewFixes(t *testing.T) {
	// The whole app is review machinery, so its instinct for every wrong
	// answer is "see it again sooner". That answer is right for exactly one of
	// the six causes the Practice page offers. For the others, rescheduling a
	// card reshuffles something that was never the problem.
	//
	// Named cause by cause rather than "everything except recall": adding a
	// seventh cause should be a decision, not an inheritance.
	for cause, want := range map[string]bool{
		"recall":   true,
		"misread":  false,
		"careless": false,
		"method":   false,
		"time":     false,
		"unknown":  false,
	} {
		if got := memory.ReviewFixes(cause); got != want {
			t.Errorf("ReviewFixes(%q) = %v, want %v", cause, got, want)
		}
	}
}

func TestACauseNobodyNamedIsNotSomethingReviewCanFix(t *testing.T) {
	// A cause the taxonomy does not know is one nothing has decided about.
	// Treating it as fixable would let an unrecognised string into the queue
	// on the strength of a typo.
	for _, cause := range []string{"", "  ", "typo", "RECALL "} {
		if memory.ReviewFixes(cause) {
			t.Errorf("ReviewFixes(%q) let an unnamed cause into the queue", cause)
		}
	}
}

func TestAMistakeBecomesOneCardAskingTheQuestionAgain(t *testing.T) {
	// A 错题 is one whole question, not a term with three angles on it. The
	// stem generator would hand back three cards, one of them empty when no
	// note was written -- and three cards for one question is the fastest way
	// to make the queue not worth opening.
	prompts := memory.GenerateMistakePrompts(memory.KnowledgeItem{
		ID:                "k-1",
		Term:              "小球从斜面顶端滑下，求到底端的速度。",
		ConciseDefinition: "动能定理",
	})
	if len(prompts) != 1 {
		t.Fatalf("prompts = %#v", prompts)
	}
	if prompts[0].KnowledgeID != "k-1" {
		t.Fatalf("knowledge id = %q", prompts[0].KnowledgeID)
	}
	if prompts[0].Type != memory.PromptMistakeRedo {
		t.Fatalf("type = %q", prompts[0].Type)
	}
	if !strings.Contains(prompts[0].Question, "小球从斜面顶端滑下") {
		t.Fatalf("question = %q -- the card has to show the question you got wrong", prompts[0].Question)
	}
	if len(prompts[0].AcceptedAnswers) == 0 || prompts[0].AcceptedAnswers[0] != "动能定理" {
		t.Fatalf("accepted = %#v -- the note you wrote is the only answer on file", prompts[0].AcceptedAnswers)
	}
}

func TestAMistakeWithNoNoteIsGradedAsFreeText(t *testing.T) {
	// EvaluateAnswer with nothing accepted calls every answer wrong, so a card
	// carrying an empty accepted answer would never graduate. An empty slice
	// is what routes the answer to free-text grading instead.
	prompts := memory.GenerateMistakePrompts(memory.KnowledgeItem{ID: "k-2", Term: "受力分析"})
	if len(prompts) != 1 {
		t.Fatalf("prompts = %#v", prompts)
	}
	if len(prompts[0].AcceptedAnswers) != 0 {
		t.Fatalf("accepted = %#v, want none", prompts[0].AcceptedAnswers)
	}
}
