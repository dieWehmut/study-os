package agent_test

import (
	"context"
	"reflect"
	"strings"
	"testing"

	"study-os/backend/agent"
)

func TestMockWordWikiProducesStableMarkdown(t *testing.T) {
	provider := agent.NewMockProvider()
	request := agent.Request{
		Kind: agent.KindWordWiki,
		WordWiki: &agent.WordWikiInput{
			Term:       "abandon",
			Definition: "to leave behind",
			Example:    "They abandoned the plan.",
			Level:      "CET4",
		},
	}
	first, err := provider.Generate(context.Background(), request)
	if err != nil {
		t.Fatalf("first generation: %v", err)
	}
	second, err := provider.Generate(context.Background(), request)
	if err != nil {
		t.Fatalf("second generation: %v", err)
	}
	if !reflect.DeepEqual(first, second) {
		t.Fatalf("wiki output is not deterministic")
	}
	if first.WordWiki == nil {
		t.Fatalf("word wiki output = %#v", first)
	}
	markdown := first.WordWiki.DetailedMarkdown
	if !strings.Contains(markdown, "abandon") || !strings.Contains(markdown, "to leave behind") {
		t.Fatalf("wiki markdown missing term or definition: %s", markdown)
	}
	if !strings.Contains(markdown, "## abandon") {
		t.Fatalf("wiki markdown must start with a term heading: %s", markdown)
	}
}

func TestMockMakeSentenceContainsTermAndBlank(t *testing.T) {
	provider := agent.NewMockProvider()
	output, err := provider.Generate(context.Background(), agent.Request{
		Kind: agent.KindMakeSentence,
		Sentence: &agent.SentenceInput{
			Term:       "abandon",
			Definition: "to leave behind",
		},
	})
	if err != nil {
		t.Fatalf("generate sentence: %v", err)
	}
	if output.Sentence == nil {
		t.Fatalf("sentence output = %#v", output)
	}
	if !strings.Contains(strings.ToLower(output.Sentence.Sentence), "abandon") {
		t.Fatalf("sentence does not contain the term: %q", output.Sentence.Sentence)
	}
	if !strings.Contains(output.Sentence.Blanked, "_____") {
		t.Fatalf("blanked sentence has no blank: %q", output.Sentence.Blanked)
	}
	if output.Sentence.Translation == "" {
		t.Fatalf("translation is empty")
	}
}

func TestMockEvaluateFreeTextFallsBackDeterministically(t *testing.T) {
	provider := agent.NewMockProvider()
	request := func(answer string, accepted []string) agent.Request {
		return agent.Request{
			Kind: agent.KindEvaluateFreeText,
			FreeText: &agent.FreeTextInput{
				Question:        "用 abandon 造句",
				Answer:          answer,
				PromptType:      "make_sentence",
				AcceptedAnswers: accepted,
			},
		}
	}

	empty, err := provider.Generate(context.Background(), request("", nil))
	if err != nil {
		t.Fatalf("empty evaluation: %v", err)
	}
	if empty.Feedback == nil || empty.Feedback.Outcome != agent.OutcomeIncorrect || empty.Feedback.Rating != agent.RatingAgain {
		t.Fatalf("empty evaluation = %#v", empty.Feedback)
	}

	partial, err := provider.Generate(context.Background(), request("I abandon my old plan.", nil))
	if err != nil {
		t.Fatalf("offline evaluation: %v", err)
	}
	if partial.Feedback == nil || partial.Feedback.Outcome != agent.OutcomePartial || partial.Feedback.Rating != agent.RatingHard {
		t.Fatalf("offline evaluation = %#v", partial.Feedback)
	}

	exact, err := provider.Generate(context.Background(), request("I abandon my old plan.", []string{"I abandon my old plan."}))
	if err != nil {
		t.Fatalf("exact evaluation: %v", err)
	}
	if exact.Feedback == nil || exact.Feedback.Outcome != agent.OutcomeCorrect {
		t.Fatalf("exact evaluation = %#v", exact.Feedback)
	}
}

func TestMockExtractMemoryPointsFromEnglishText(t *testing.T) {
	provider := agent.NewMockProvider()
	output, err := provider.Generate(context.Background(), agent.Request{
		Kind: agent.KindExtractMemoryPoints,
		Extract: &agent.ExtractInput{
			Title:     "Vocabulary",
			Subject:   "english",
			Text:      "Learning new words every day helps memory. Practice matters most.",
			MaxPoints: 5,
		},
	})
	if err != nil {
		t.Fatalf("extract points: %v", err)
	}
	if output.Extract == nil || len(output.Extract.Points) == 0 {
		t.Fatalf("extract output = %#v", output.Extract)
	}
	if len(output.Extract.Points) > 5 {
		t.Fatalf("points exceed cap: %d", len(output.Extract.Points))
	}
	for _, point := range output.Extract.Points {
		if point.ItemType != "word_sense" {
			t.Fatalf("point item type = %q", point.ItemType)
		}
		if !containsTag(point.Tags, "auto_extract") {
			t.Fatalf("point tags = %#v", point.Tags)
		}
	}
}

func TestMockExtractMemoryPointsFromChineseText(t *testing.T) {
	provider := agent.NewMockProvider()
	output, err := provider.Generate(context.Background(), agent.Request{
		Kind: agent.KindExtractMemoryPoints,
		Extract: &agent.ExtractInput{
			Title:     "文言文",
			Subject:   "chinese",
			Text:      "学而时习之，不亦说乎。有朋自远方来，不亦乐乎。",
			MaxPoints: 3,
		},
	})
	if err != nil {
		t.Fatalf("extract points: %v", err)
	}
	if output.Extract == nil || len(output.Extract.Points) != 2 {
		t.Fatalf("extract output = %#v", output.Extract)
	}
	if output.Extract.Points[0].ItemType != "sentence" {
		t.Fatalf("chinese point item type = %q", output.Extract.Points[0].ItemType)
	}
}

func TestMockCompressSensesGroupsByPrefix(t *testing.T) {
	provider := agent.NewMockProvider()
	output, err := provider.Generate(context.Background(), agent.Request{
		Kind: agent.KindCompressSenses,
		Compress: &agent.CompressInput{
			Term: "run",
			Senses: []agent.SenseInput{
				{Index: 0, Definition: "to move quickly on foot"},
				{Index: 1, Definition: "to move quickly on foot for exercise"},
				{Index: 2, Definition: "to operate a machine"},
			},
		},
	})
	if err != nil {
		t.Fatalf("compress senses: %v", err)
	}
	if output.Compress == nil || len(output.Compress.Groups) == 0 {
		t.Fatalf("compress output = %#v", output.Compress)
	}
	first := output.Compress.Groups[0]
	if len(first.SenseIndexes) == 0 || first.MergedDefinition == "" {
		t.Fatalf("first group = %#v", first)
	}
}

func TestRequestValidateCoversNewKinds(t *testing.T) {
	provider := agent.NewMockProvider()
	tests := []agent.Request{
		{Kind: agent.KindWordWiki},
		{Kind: agent.KindMakeSentence},
		{Kind: agent.KindEvaluateFreeText},
		{Kind: agent.KindExtractMemoryPoints},
		{Kind: agent.KindCompressSenses},
	}
	for _, request := range tests {
		if _, err := provider.Generate(context.Background(), request); err == nil {
			t.Fatalf("kind %q with missing input unexpectedly succeeded", request.Kind)
		}
	}
}

func containsTag(tags []string, wanted string) bool {
	for _, tag := range tags {
		if tag == wanted {
			return true
		}
	}
	return false
}
