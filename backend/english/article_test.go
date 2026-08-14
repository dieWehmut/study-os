package english_test

import (
	"context"
	"strings"
	"testing"

	"study-os/backend/agent"
	"study-os/backend/english"
)

func TestGeneratePreviewNormalizesMetadataAndCanonicalMarkdown(t *testing.T) {
	service := english.NewArticleService(agent.NewMockProvider())
	preview, err := service.GeneratePreview(context.Background(), agent.EnglishArticleInput{
		OriginalText:  "Learning slowly builds durable skill. Practice turns knowledge into ability.",
		Title:         "  Display title  ",
		OriginalTitle: "  User supplied title  ",
		Author:        "  User supplied author ",
		SourceName:    "  User source ",
		SourceURL:     "https://example.test/article",
		PublishedAt:   "2026-08-15",
	}, agent.Options{Model: "test-model"})
	if err != nil {
		t.Fatalf("generate preview: %v", err)
	}
	if preview.Content.Title != "Display title" || len(preview.Content.Sections) < 2 {
		t.Fatalf("preview content = %#v", preview.Content)
	}
	if preview.Content.Metadata.OriginalTitle != "User supplied title" || preview.Content.Metadata.Author != "User supplied author" {
		t.Fatalf("user metadata was not preserved: %#v", preview.Content.Metadata)
	}
	if preview.Provider != "mock" || preview.Model != "test-model" {
		t.Fatalf("provider metadata = %#v", preview)
	}
	for _, marker := range []string{"User supplied title", "User supplied author", "<u>Learning", "Practice", "**"} {
		if !strings.Contains(preview.Markdown, marker) {
			t.Errorf("canonical markdown missing %q: %s", marker, preview.Markdown)
		}
	}
	if !strings.Contains(preview.Markdown, "[link](https://example.test/article)") {
		t.Fatalf("canonical source link is malformed: %s", preview.Markdown)
	}
}

func TestCanonicalMarkdownJoinsSegmentsWithoutDroppingSpaces(t *testing.T) {
	provider := fixedArticleProvider{response: agent.Response{
		Kind: agent.KindEnglishArticle,
		EnglishArticle: &agent.EnglishArticleOutput{
			Title:    "Generated",
			Metadata: agent.EnglishArticleMetadata{},
			Sections: []agent.EnglishArticleSection{{
				Title: "First",
				Paragraphs: []agent.EnglishArticleParagraph{{
					Segments:    []agent.EnglishArticleSegment{{Text: "Read "}, {Text: "this", Emphasized: true}, {Text: " closely."}},
					Translation: "仔细阅读这篇文章。",
				}},
				Vocabulary: []agent.EnglishArticleVocabulary{{Term: "closely", Definition: "仔细地", Examples: []string{"Read this closely."}}},
			}},
		},
	}}
	preview, err := english.NewArticleService(provider).GeneratePreview(context.Background(), agent.EnglishArticleInput{OriginalText: "Read this closely."})
	if err != nil {
		t.Fatalf("generate preview: %v", err)
	}
	if !strings.Contains(preview.Markdown, "> Read <u>this</u> closely.") {
		t.Fatalf("joined paragraph lost spaces or underline: %s", preview.Markdown)
	}
}

func TestNormalizeArticleRejectsUntitledSections(t *testing.T) {
	_, err := english.NormalizeArticle(
		agent.EnglishArticleInput{OriginalText: "Read closely."},
		agent.EnglishArticleOutput{
			Title: "Reading",
			Sections: []agent.EnglishArticleSection{{
				Title: " ",
				Paragraphs: []agent.EnglishArticleParagraph{{
					Segments:    []agent.EnglishArticleSegment{{Text: "Read closely."}},
					Translation: "仔细阅读。",
				}},
			}},
		},
	)
	if err == nil {
		t.Fatal("untitled section unexpectedly normalized")
	}
}

func TestNormalizeArticleRejectsContentThatDoesNotMatchTheSource(t *testing.T) {
	_, err := english.NormalizeArticle(
		agent.EnglishArticleInput{OriginalText: "First source sentence. Second source sentence."},
		agent.EnglishArticleOutput{
			Title: "Reading",
			Sections: []agent.EnglishArticleSection{{
				Title: "Opening",
				Paragraphs: []agent.EnglishArticleParagraph{{
					Segments:    []agent.EnglishArticleSegment{{Text: "Unrelated generated sentence."}},
					Translation: "无关的生成句子。",
				}},
			}},
		},
	)
	if err == nil {
		t.Fatal("article content unrelated to the source unexpectedly normalized")
	}
}

func TestNormalizeArticlePreservesWordBoundaries(t *testing.T) {
	_, err := english.NormalizeArticle(
		agent.EnglishArticleInput{OriginalText: "The data base is stable."},
		agent.EnglishArticleOutput{
			Title: "Reading",
			Sections: []agent.EnglishArticleSection{{
				Title: "Opening",
				Paragraphs: []agent.EnglishArticleParagraph{{
					Segments:    []agent.EnglishArticleSegment{{Text: "The database is stable."}},
					Translation: "涓€涓湁鏁堢殑缈昏銆?",
				}},
			}},
		},
	)
	if err == nil {
		t.Fatal("normalization accepted a changed word boundary")
	}
}

func TestNormalizeArticleRejectsUnsafeSourceURLs(t *testing.T) {
	_, err := english.NormalizeArticle(
		agent.EnglishArticleInput{OriginalText: "Read closely.", SourceURL: "javascript:alert(1)"},
		agent.EnglishArticleOutput{
			Title: "Reading",
			Sections: []agent.EnglishArticleSection{{
				Title: "Opening",
				Paragraphs: []agent.EnglishArticleParagraph{{
					Segments:    []agent.EnglishArticleSegment{{Text: "Read closely."}},
					Translation: "仔细阅读。",
				}},
			}},
		},
	)
	if err == nil {
		t.Fatal("unsafe source URL unexpectedly normalized")
	}
}

func TestCanonicalMarkdownEscapesUntrustedStructureCharacters(t *testing.T) {
	markdown := english.CanonicalMarkdown(agent.EnglishArticleOutput{
		Title: "Reading\n---",
		Sections: []agent.EnglishArticleSection{{
			Title: "Opening\n## injected",
			Paragraphs: []agent.EnglishArticleParagraph{{
				Segments:    []agent.EnglishArticleSegment{{Text: "Read\n# heading *bold* [link](https://example.test)"}},
				Translation: "翻译\n> injected",
			}},
		}},
	})
	for _, unsafe := range []string{"Reading\n---", "\n## injected", "\n# heading", "*bold*", "[link](https://example.test)", "\n> injected"} {
		if strings.Contains(markdown, unsafe) {
			t.Fatalf("canonical markdown contains unsafe structure %q:\n%s", unsafe, markdown)
		}
	}
}

type fixedArticleProvider struct{ response agent.Response }

func (p fixedArticleProvider) Name() string { return "fixed" }
func (p fixedArticleProvider) Generate(context.Context, agent.Request) (agent.Response, error) {
	return p.response, nil
}
