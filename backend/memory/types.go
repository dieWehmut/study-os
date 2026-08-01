package memory

import (
	"strings"
)

type KnowledgeItem struct {
	ID                string
	Term              string
	ConciseDefinition string
	Example           string
	AcceptedMeanings  []string
	AcceptedTerms     []string
}

type PromptType string

const (
	PromptEnglishToChinese PromptType = "en_to_zh"
	PromptChineseToEnglish PromptType = "zh_to_en"
	PromptContextCloze     PromptType = "context_cloze"
)

type Prompt struct {
	ID              string
	KnowledgeID     string
	Type            PromptType
	Question        string
	AcceptedAnswers []string
}

type Outcome string

const (
	OutcomeIncorrect Outcome = "incorrect"
	OutcomePartial   Outcome = "partial"
	OutcomeCorrect   Outcome = "correct"
)

type Rating int

const (
	RatingAgain Rating = iota + 1
	RatingHard
	RatingGood
)

type Evaluation struct {
	Outcome  Outcome
	Rating   Rating
	Feedback string
}

func GeneratePrompts(item KnowledgeItem) []Prompt {
	meanings := splitAlternatives(item.AcceptedMeanings)
	if len(meanings) == 0 && item.ConciseDefinition != "" {
		meanings = splitAlternatives([]string{item.ConciseDefinition})
	}
	terms := splitAlternatives(item.AcceptedTerms)
	if len(terms) == 0 && item.Term != "" {
		terms = []string{item.Term}
	}
	cloze := item.Example
	if cloze != "" {
		cloze = strings.Replace(cloze, item.Term, "_____", 1)
	}
	if cloze == item.Example || cloze == "" {
		cloze = "Choose the English expression for \"" + item.ConciseDefinition + "\": _____."
	}
	return []Prompt{
		{KnowledgeID: item.ID, Type: PromptEnglishToChinese, Question: item.Term, AcceptedAnswers: meanings},
		{KnowledgeID: item.ID, Type: PromptChineseToEnglish, Question: item.ConciseDefinition, AcceptedAnswers: terms},
		{KnowledgeID: item.ID, Type: PromptContextCloze, Question: cloze, AcceptedAnswers: terms},
	}
}

func splitAlternatives(values []string) []string {
	result := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		parts := strings.FieldsFunc(value, func(r rune) bool {
			switch r {
			case ';', '\uff1b', '/', '\uff0f', '|', '\uff5c':
				return true
			default:
				return false
			}
		})
		for _, part := range parts {
			part = strings.TrimSpace(part)
			if part == "" {
				continue
			}
			if _, exists := seen[part]; exists {
				continue
			}
			seen[part] = struct{}{}
			result = append(result, part)
		}
	}
	return result
}
