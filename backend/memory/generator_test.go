package memory

import "testing"

func TestGeneratePromptsCreatesFourEnglishChecks(t *testing.T) {
	item := KnowledgeItem{
		ID:                "knowledge-1",
		ItemType:          "word_sense",
		Term:              "abandon",
		ConciseDefinition: "放弃；抛弃",
		Example:           "They had to abandon the damaged car.",
	}

	prompts := GeneratePrompts(item)

	if len(prompts) != 4 {
		t.Fatalf("len(prompts) = %d, want 4", len(prompts))
	}
	byType := make(map[PromptType]Prompt, len(prompts))
	for _, prompt := range prompts {
		byType[prompt.Type] = prompt
	}
	if byType[PromptEnglishToChinese].Question != "abandon" {
		t.Fatalf("unexpected en_to_zh prompt: %#v", byType[PromptEnglishToChinese])
	}
	if byType[PromptChineseToEnglish].Question != "放弃；抛弃" {
		t.Fatalf("unexpected zh_to_en prompt: %#v", byType[PromptChineseToEnglish])
	}
	if byType[PromptContextCloze].Question != "They had to _____ the damaged car." {
		t.Fatalf("unexpected cloze prompt: %#v", byType[PromptContextCloze])
	}
	if byType[PromptMakeSentence].Question == "" {
		t.Fatalf("unexpected make-sentence prompt: %#v", byType[PromptMakeSentence])
	}
	for _, prompt := range prompts {
		if prompt.Type != PromptMakeSentence && len(prompt.AcceptedAnswers) == 0 {
			t.Fatalf("prompt %q has no answers", prompt.Type)
		}
	}
}

func TestGeneratePromptsSkipsSentencePromptForNonWordItems(t *testing.T) {
	prompts := GeneratePrompts(KnowledgeItem{
		ID:                "knowledge-4",
		ItemType:          "classic_text",
		Term:              "论语十二章",
		ConciseDefinition: "经典文言文",
	})
	if len(prompts) != 3 {
		t.Fatalf("len(prompts) = %d, want 3", len(prompts))
	}
	for _, prompt := range prompts {
		if prompt.Type == PromptMakeSentence {
			t.Fatalf("non-word item must not get a sentence prompt: %#v", prompt)
		}
	}
}

func TestGeneratePromptsUsesDeterministicClozeFallback(t *testing.T) {
	prompts := GeneratePrompts(KnowledgeItem{
		ID:                "knowledge-2",
		ItemType:          "word_sense",
		Term:              "resilient",
		ConciseDefinition: "有韧性的；能复原的",
	})

	if got := prompts[2].Question; got != "Choose the English expression for \"有韧性的；能复原的\": _____." {
		t.Fatalf("fallback = %q", got)
	}
}

func TestGeneratePromptsTreatsDefinitionAlternativesAsSeparateAnswers(t *testing.T) {
	prompts := GeneratePrompts(KnowledgeItem{
		ID:                "knowledge-3",
		ItemType:          "word_sense",
		Term:              "abandon",
		ConciseDefinition: "放弃；抛弃",
		AcceptedMeanings:  []string{"放弃；抛弃"},
	})

	answers := prompts[0].AcceptedAnswers
	if len(answers) != 2 || answers[0] != "放弃" || answers[1] != "抛弃" {
		t.Fatalf("accepted answers = %#v, want separate definition alternatives", answers)
	}
}
