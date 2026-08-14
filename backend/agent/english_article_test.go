package agent

import (
	"context"
	"strings"
	"testing"
)

func TestEnglishArticleRequestValidateRequiresOriginalText(t *testing.T) {
	request := Request{Kind: KindEnglishArticle, EnglishArticle: &EnglishArticleInput{}}
	if err := request.Validate(); err == nil {
		t.Fatal("empty English article request unexpectedly validated")
	}

	request.EnglishArticle = &EnglishArticleInput{OriginalText: "A short article."}
	if err := request.Validate(); err != nil {
		t.Fatalf("valid English article request rejected: %v", err)
	}
}

func TestDecodeProviderOutputEnglishArticle(t *testing.T) {
	content := `{"title":"Improved title","metadata":{"original_title":"Original","author":"Author"},"sections":[{"title":"Section one","paragraphs":[{"segments":[{"text":"Read ","emphasized":false},{"text":"closely","emphasized":true}],"translation":"仔细阅读。"}],"vocabulary":[{"term":"closely","part_of_speech":"adv.","definition":"仔细地"}]}]}`
	response, err := decodeProviderOutput(KindEnglishArticle, content)
	if err != nil {
		t.Fatalf("decode English article: %v", err)
	}
	if response.EnglishArticle == nil || response.EnglishArticle.Title != "Improved title" {
		t.Fatalf("decoded output = %#v", response.EnglishArticle)
	}
	if got := response.EnglishArticle.Sections[0].Paragraphs[0].Segments[1].Text; got != "closely" {
		t.Fatalf("emphasized segment = %q", got)
	}
}

func TestDecodeProviderOutputEnglishArticleRejectsUnknownFields(t *testing.T) {
	content := `{"title":"Reading","metadata":{},"sections":[{"title":"Section","paragraphs":[{"segments":[{"text":"Read closely."}],"translation":"仔细阅读。"}]}],"unexpected":true}`
	if _, err := decodeProviderOutput(KindEnglishArticle, content); err == nil {
		t.Fatal("English article with unknown fields unexpectedly decoded")
	}
}

func TestEnglishArticlePromptsDescribeStructuredOutput(t *testing.T) {
	system := systemPromptFor(KindEnglishArticle)
	for _, field := range []string{"title", "metadata", "sections", "segments", "translation", "vocabulary"} {
		if !strings.Contains(system, field) {
			t.Errorf("system prompt missing %q: %s", field, system)
		}
	}
	request := Request{Kind: KindEnglishArticle, EnglishArticle: &EnglishArticleInput{OriginalText: "Original text", Title: "Display title", OriginalTitle: "Input title", Author: "Input author"}}
	user := userPromptFor(request)
	for _, value := range []string{"Original text", "Display title", "Input title", "Input author"} {
		if !strings.Contains(user, value) {
			t.Errorf("user prompt missing %q: %s", value, user)
		}
	}
}

func TestMockEnglishArticleReturnsTwoStableSections(t *testing.T) {
	provider := NewMockProvider()
	request := Request{Kind: KindEnglishArticle, EnglishArticle: &EnglishArticleInput{
		OriginalText:  "Learning slowly builds durable skill. Practice turns knowledge into ability.",
		OriginalTitle: "Learning",
		Author:        "A. Writer",
	}}
	first, err := provider.Generate(context.Background(), request)
	if err != nil {
		t.Fatalf("first generation: %v", err)
	}
	second, err := provider.Generate(context.Background(), request)
	if err != nil {
		t.Fatalf("second generation: %v", err)
	}
	if first.EnglishArticle == nil || len(first.EnglishArticle.Sections) < 2 {
		t.Fatalf("mock article has too few sections: %#v", first.EnglishArticle)
	}
	if first.EnglishArticle.Title != second.EnglishArticle.Title || len(first.EnglishArticle.Sections) != len(second.EnglishArticle.Sections) {
		t.Fatalf("mock article is not stable: first=%#v second=%#v", first.EnglishArticle, second.EnglishArticle)
	}
	for _, section := range first.EnglishArticle.Sections {
		if len(section.Paragraphs) == 0 {
			t.Fatal("mock section has no paragraphs")
		}
		for _, paragraph := range section.Paragraphs {
			var joined strings.Builder
			for _, segment := range paragraph.Segments {
				joined.WriteString(segment.Text)
			}
			if strings.TrimSpace(joined.String()) == "" || strings.TrimSpace(paragraph.Translation) == "" {
				t.Fatalf("mock paragraph is incomplete: %#v", paragraph)
			}
			if !strings.Contains(request.EnglishArticle.OriginalText, strings.TrimSpace(joined.String())) {
				t.Fatalf("mock paragraph segments changed the source: %q", joined.String())
			}
		}
	}
}

func TestMockEnglishArticlePreservesEverySourceSentenceOnce(t *testing.T) {
	provider := NewMockProvider()
	source := "First sentence introduces the topic. Second sentence develops the argument. Third sentence completes the conclusion."
	response, err := provider.Generate(context.Background(), Request{
		Kind:           KindEnglishArticle,
		EnglishArticle: &EnglishArticleInput{OriginalText: source},
	})
	if err != nil {
		t.Fatalf("generate mock English article: %v", err)
	}
	if response.EnglishArticle == nil {
		t.Fatal("mock English article is nil")
	}

	var rendered strings.Builder
	for _, section := range response.EnglishArticle.Sections {
		for _, paragraph := range section.Paragraphs {
			for _, segment := range paragraph.Segments {
				rendered.WriteString(segment.Text)
			}
			rendered.WriteByte(' ')
		}
	}
	for _, sentence := range sentences(source) {
		if count := strings.Count(rendered.String(), sentence); count != 1 {
			t.Fatalf("source sentence %q appears %d times in mock output: %q", sentence, count, rendered.String())
		}
	}
}
