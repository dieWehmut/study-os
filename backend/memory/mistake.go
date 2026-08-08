package memory

import "strings"

// reviewFixableCauses names the error causes that seeing the question again
// actually repairs.
//
// A set rather than "everything except careless" so that adding a seventh
// cause is a decision someone has to make, not something it inherits. The
// Practice page keeps its own copy to decide whether to offer the button; this
// one is the answer that binds, because it is the one guarding the queue.
var reviewFixableCauses = map[string]bool{
	"recall": true,
}

// ReviewFixes answers whether putting a question back in the spaced-review
// queue would fix a mistake made for this reason.
//
// The whole app is review machinery, so its instinct for every wrong answer is
// "see it again sooner". That answer is right for 想不起来 and wrong for the
// rest: rescheduling a card you misread, or ran out of time on, reshuffles
// something that was never the problem, and the mistake comes back looking
// like a memory failure it never was.
//
// Matched exactly, not case-folded. The store canonicalises a cause on the way
// in, and the Practice page looks its label up by exact string -- a row whose
// cause is spelled differently is already one the page refuses to draw. Being
// lenient only here would put a card in the queue for a mistake nothing can
// show you.
func ReviewFixes(cause string) bool {
	return reviewFixableCauses[cause]
}

// GenerateMistakePrompts turns one wrong answer into the card that asks it
// again.
//
// One card, not three. GeneratePrompts offers a term three angles -- recall
// it, define it, name it from a description -- which suits a 词条 and not a
// 题目: a question has one thing to ask, and asking it three ways would triple
// the cost of the heaviest kind of review item there is.
//
// Term carries the stem and ConciseDefinition the note, matching how the
// handler builds the item, so the card shows the question and grades against
// whatever correction was written down.
func GenerateMistakePrompts(item KnowledgeItem) []Prompt {
	stem := strings.TrimSpace(item.Term)
	if stem == "" {
		return nil
	}
	// An empty slice rather than a slice holding "": EvaluateAnswer calls every
	// answer wrong when nothing it holds matches, so a card carrying a blank
	// accepted answer could never graduate. Nothing accepted is what routes the
	// answer to free-text grading instead.
	accepted := splitAlternatives([]string{item.ConciseDefinition})
	return []Prompt{{
		KnowledgeID:     item.ID,
		Type:            PromptMistakeRedo,
		Question:        "重做这道错题，并说出这一步的依据：\n" + stem,
		AcceptedAnswers: accepted,
	}}
}
