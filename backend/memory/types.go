package memory

import (
	"strings"
)

type KnowledgeItem struct {
	ID                string
	ItemType          string
	Subject           string
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
	PromptMakeSentence     PromptType = "make_sentence"
	PromptDefinitionRecall PromptType = "definition_recall"
	PromptDefinitionTerm   PromptType = "definition_term"
	PromptFormulaRecall    PromptType = "formula_recall"
	PromptVerseFill        PromptType = "verse_fill"
	PromptMistakeRedo      PromptType = "mistake_redo"
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
	switch strings.ToLower(strings.TrimSpace(item.Subject)) {
	case "english":
		return englishPrompts(item)
	case "chinese":
		return chinesePrompts(item)
	default:
		if isEnglishWordItem(item.ItemType) {
			return englishPrompts(item)
		}
		return stemPrompts(item)
	}
}

func englishPrompts(item KnowledgeItem) []Prompt {
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
	prompts := []Prompt{
		{KnowledgeID: item.ID, Type: PromptEnglishToChinese, Question: item.Term, AcceptedAnswers: meanings},
		{KnowledgeID: item.ID, Type: PromptChineseToEnglish, Question: item.ConciseDefinition, AcceptedAnswers: terms},
		{KnowledgeID: item.ID, Type: PromptContextCloze, Question: cloze, AcceptedAnswers: terms},
	}
	if wantsSentencePrompt(item.ItemType) {
		prompts = append(prompts, Prompt{
			KnowledgeID: item.ID,
			Type:        PromptMakeSentence,
			Question:    "用 \"" + item.Term + "\" 造一个英文句子，并给出中文翻译。",
		})
	}
	return prompts
}

func chinesePrompts(item KnowledgeItem) []Prompt {
	meanings := splitAlternatives(item.AcceptedMeanings)
	if len(meanings) == 0 && item.ConciseDefinition != "" {
		meanings = splitAlternatives([]string{item.ConciseDefinition})
	}
	terms := splitAlternatives(item.AcceptedTerms)
	if len(terms) == 0 && item.Term != "" {
		terms = []string{item.Term}
	}
	return []Prompt{
		{
			KnowledgeID: item.ID,
			Type:        PromptVerseFill,
			Question:    "根据提示完成背诵：「" + item.Term + "」——请写出完整内容（上句接下句或默写全文）。",
		},
		{
			KnowledgeID:     item.ID,
			Type:            PromptDefinitionRecall,
			Question:        "「" + item.Term + "」指什么？请用自己的话准确复述。",
			AcceptedAnswers: meanings,
		},
		{
			KnowledgeID:     item.ID,
			Type:            PromptDefinitionTerm,
			Question:        "看到以下内容，写出对应的篇目/词条：" + item.ConciseDefinition,
			AcceptedAnswers: terms,
		},
	}
}

func stemPrompts(item KnowledgeItem) []Prompt {
	meanings := splitAlternatives(item.AcceptedMeanings)
	if len(meanings) == 0 && item.ConciseDefinition != "" {
		meanings = splitAlternatives([]string{item.ConciseDefinition})
	}
	terms := splitAlternatives(item.AcceptedTerms)
	if len(terms) == 0 && item.Term != "" {
		terms = []string{item.Term}
	}
	return []Prompt{
		{
			KnowledgeID: item.ID,
			Type:        PromptFormulaRecall,
			Question:    "默写/复述：「" + item.Term + "」，并说出适用条件或易错点。",
		},
		{
			KnowledgeID:     item.ID,
			Type:            PromptDefinitionRecall,
			Question:        "「" + item.Term + "」的含义/结论是什么？",
			AcceptedAnswers: meanings,
		},
		{
			KnowledgeID:     item.ID,
			Type:            PromptDefinitionTerm,
			Question:        "看到以下描述，写出对应的结论/符号/术语：" + item.ConciseDefinition,
			AcceptedAnswers: terms,
		},
	}
}

func isEnglishWordItem(itemType string) bool {
	switch itemType {
	case "", "word_sense", "phrase", "collocation", "word_family", "root_affix":
		return true
	default:
		return false
	}
}

func wantsSentencePrompt(itemType string) bool {
	switch itemType {
	case "", "word_sense", "phrase", "collocation", "word_family", "root_affix":
		return true
	default:
		return false
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
