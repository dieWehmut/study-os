package memory

import "testing"

func TestGeneratePromptsCreatesThreeEnglishChecks(t *testing.T) {
	item := KnowledgeItem{
		ID:                "knowledge-1",
		Term:              "abandon",
		ConciseDefinition: "放弃；抛弃",
		Example:           "They had to abandon the damaged car.",
	}

	prompts := GeneratePrompts(item)

	if len(prompts) != 3 {
		t.Fatalf("len(prompts) = %d, want 3", len(prompts))
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
	for _, prompt := range prompts {
		if len(prompt.AcceptedAnswers) == 0 {
			t.Fatalf("prompt %q has no answers", prompt.Type)
		}
	}
}

func TestGeneratePromptsUsesDeterministicClozeFallback(t *testing.T) {
	prompts := GeneratePrompts(KnowledgeItem{
		ID:                "knowledge-2",
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
		Term:              "abandon",
		ConciseDefinition: "\u653e\u5f03\uff1b\u629b\u5f03",
		AcceptedMeanings:  []string{"\u653e\u5f03\uff1b\u629b\u5f03"},
	})

	answers := prompts[0].AcceptedAnswers
	if len(answers) != 2 || answers[0] != "\u653e\u5f03" || answers[1] != "\u629b\u5f03" {
		t.Fatalf("accepted answers = %#v, want separate definition alternatives", answers)
	}
}
