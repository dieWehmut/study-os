package english

import (
	"context"
	"fmt"
	"html"
	"net/url"
	"strings"
	"unicode"

	"study-os/backend/agent"
)

// The article service keeps the provider boundary independent from storage and
// HTTP. It validates the model response, applies user-owned metadata, and
// creates the single canonical Markdown representation used by persistence
// and the browser preview.
type ArticleService struct {
	provider agent.Provider
}

func NewArticleService(provider agent.Provider) *ArticleService {
	return &ArticleService{provider: provider}
}

type ArticleContent = agent.EnglishArticleOutput
type ArticleMetadata = agent.EnglishArticleMetadata
type ArticleSection = agent.EnglishArticleSection
type ArticleParagraph = agent.EnglishArticleParagraph
type ArticleSegment = agent.EnglishArticleSegment
type ArticleVocabulary = agent.EnglishArticleVocabulary

type Preview struct {
	Content  ArticleContent `json:"content"`
	Markdown string         `json:"markdown"`
	Provider string         `json:"provider"`
	Model    string         `json:"model,omitempty"`
}

func (s *ArticleService) GeneratePreview(ctx context.Context, input agent.EnglishArticleInput, optionValues ...agent.Options) (Preview, error) {
	if s == nil || s.provider == nil {
		return Preview{}, articleError("English article provider is unavailable")
	}
	var options agent.Options
	if len(optionValues) > 0 {
		options = optionValues[0]
	}
	request := agent.Request{Kind: agent.KindEnglishArticle, Options: options, EnglishArticle: &input}
	if err := request.Validate(); err != nil {
		return Preview{}, err
	}
	response, err := s.provider.Generate(ctx, request)
	if err != nil {
		return Preview{}, err
	}
	if response.Kind != agent.KindEnglishArticle || response.EnglishArticle == nil {
		return Preview{}, articleError("provider returned no English article")
	}
	content, err := NormalizeArticle(input, *response.EnglishArticle)
	if err != nil {
		return Preview{}, err
	}
	return Preview{
		Content:  content,
		Markdown: CanonicalMarkdown(content),
		Provider: s.provider.Name(),
		Model:    strings.TrimSpace(options.Model),
	}, nil
}

// NormalizeArticle applies the user's factual metadata and rejects malformed
// model output before it can be rendered or persisted.
func NormalizeArticle(input agent.EnglishArticleInput, output agent.EnglishArticleOutput) (ArticleContent, error) {
	if strings.TrimSpace(input.OriginalText) == "" {
		return ArticleContent{}, articleError("original text is required")
	}
	content := ArticleContent{
		Title:    cleanSpace(output.Title),
		Metadata: normalizeMetadata(input, output.Metadata),
		Sections: make([]agent.EnglishArticleSection, 0, len(output.Sections)),
	}
	if value := cleanSpace(input.Title); value != "" {
		content.Title = value
	}
	if content.Title == "" {
		content.Title = cleanSpace(input.OriginalTitle)
	}
	if content.Title == "" {
		content.Title = "English Reading Article"
	}
	if len(output.Sections) == 0 {
		return ArticleContent{}, articleError("English article must contain at least one section")
	}
	for sectionIndex, section := range output.Sections {
		normalized, err := normalizeSection(section, sectionIndex)
		if err != nil {
			return ArticleContent{}, err
		}
		content.Sections = append(content.Sections, normalized)
	}
	if sourceArticleText(content) != stripWhitespace(input.OriginalText) {
		return ArticleContent{}, articleError("English article paragraphs must preserve the complete original text")
	}
	if content.Metadata.SourceURL != "" {
		parsed, err := url.Parse(content.Metadata.SourceURL)
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
			return ArticleContent{}, articleError("source URL must use http or https")
		}
	}
	return content, nil
}

func sourceArticleText(content ArticleContent) string {
	var builder strings.Builder
	for _, section := range content.Sections {
		for _, paragraph := range section.Paragraphs {
			for _, segment := range paragraph.Segments {
				builder.WriteString(segment.Text)
			}
		}
	}
	return stripWhitespace(builder.String())
}

func stripWhitespace(value string) string {
	return strings.Map(func(r rune) rune {
		if unicode.IsSpace(r) {
			return -1
		}
		return r
	}, value)
}

func normalizeMetadata(input agent.EnglishArticleInput, generated agent.EnglishArticleMetadata) agent.EnglishArticleMetadata {
	metadata := agent.EnglishArticleMetadata{
		OriginalTitle: cleanSpace(generated.OriginalTitle),
		Author:        cleanSpace(generated.Author),
		SourceName:    cleanSpace(generated.SourceName),
		SourceURL:     cleanSpace(generated.SourceURL),
		PublishedAt:   cleanSpace(generated.PublishedAt),
	}
	if value := cleanSpace(input.OriginalTitle); value != "" {
		metadata.OriginalTitle = value
	}
	if value := cleanSpace(input.Author); value != "" {
		metadata.Author = value
	}
	if value := cleanSpace(input.SourceName); value != "" {
		metadata.SourceName = value
	}
	if value := cleanSpace(input.SourceURL); value != "" {
		metadata.SourceURL = value
	}
	if value := cleanSpace(input.PublishedAt); value != "" {
		metadata.PublishedAt = value
	}
	return metadata
}

func normalizeSection(section agent.EnglishArticleSection, sectionIndex int) (agent.EnglishArticleSection, error) {
	section.Title = cleanSpace(section.Title)
	if section.Title == "" {
		return agent.EnglishArticleSection{}, articleError(fmt.Sprintf("section %d title is required", sectionIndex+1))
	}
	if len(section.Paragraphs) == 0 {
		return agent.EnglishArticleSection{}, articleError(fmt.Sprintf("section %d must contain a paragraph", sectionIndex+1))
	}
	normalized := agent.EnglishArticleSection{Title: section.Title, Paragraphs: make([]agent.EnglishArticleParagraph, 0, len(section.Paragraphs))}
	for paragraphIndex, paragraph := range section.Paragraphs {
		if len(paragraph.Segments) == 0 {
			return agent.EnglishArticleSection{}, articleError(fmt.Sprintf("section %d paragraph %d has no segments", sectionIndex+1, paragraphIndex+1))
		}
		joined := strings.Builder{}
		segments := make([]agent.EnglishArticleSegment, 0, len(paragraph.Segments))
		for segmentIndex, segment := range paragraph.Segments {
			if strings.TrimSpace(segment.Text) == "" {
				return agent.EnglishArticleSection{}, articleError(fmt.Sprintf("section %d paragraph %d segment %d is empty", sectionIndex+1, paragraphIndex+1, segmentIndex+1))
			}
			segment.Text = strings.TrimRight(segment.Text, "\r\n")
			joined.WriteString(segment.Text)
			segments = append(segments, segment)
		}
		if strings.TrimSpace(joined.String()) == "" {
			return agent.EnglishArticleSection{}, articleError(fmt.Sprintf("section %d paragraph %d is empty", sectionIndex+1, paragraphIndex+1))
		}
		translation := cleanSpace(paragraph.Translation)
		if translation == "" {
			return agent.EnglishArticleSection{}, articleError(fmt.Sprintf("section %d paragraph %d translation is required", sectionIndex+1, paragraphIndex+1))
		}
		normalized.Paragraphs = append(normalized.Paragraphs, agent.EnglishArticleParagraph{Segments: segments, Translation: translation})
	}
	for _, item := range section.Vocabulary {
		item.Term = cleanSpace(item.Term)
		item.Definition = cleanSpace(item.Definition)
		if item.Term == "" && item.Definition == "" {
			continue
		}
		if item.Term == "" || item.Definition == "" {
			return agent.EnglishArticleSection{}, articleError(fmt.Sprintf("section %d contains an incomplete vocabulary item", sectionIndex+1))
		}
		item.BritishPhonetic = cleanSpace(item.BritishPhonetic)
		item.AmericanPhonetic = cleanSpace(item.AmericanPhonetic)
		item.PartOfSpeech = cleanSpace(item.PartOfSpeech)
		item.Usage = cleanSpace(item.Usage)
		item.Examples = cleanExamples(item.Examples)
		normalized.Vocabulary = append(normalized.Vocabulary, item)
	}
	return normalized, nil
}

func cleanExamples(examples []string) []string {
	result := make([]string, 0, len(examples))
	for _, example := range examples {
		if value := cleanSpace(example); value != "" {
			result = append(result, value)
		}
	}
	return result
}

// CanonicalMarkdown emits the Nexus-style format: front matter, hierarchical
// section headings, bilingual blockquotes, safe <u> emphasis, and vocabulary
// bullets. Text is HTML-escaped so only emphasis introduced by this function
// can create markup.
func CanonicalMarkdown(content ArticleContent) string {
	var builder strings.Builder
	builder.WriteString("---\n")
	builder.WriteString("title: ")
	builder.WriteString(yamlScalar(content.Title))
	builder.WriteByte('\n')
	if date := content.Metadata.PublishedAt; date != "" {
		builder.WriteString("date: ")
		builder.WriteString(yamlScalar(date))
		builder.WriteByte('\n')
	}
	builder.WriteString("tags: [English, Reading, Notes]\n---\n\n")
	if metadata := content.Metadata; metadata.OriginalTitle != "" || metadata.Author != "" || metadata.SourceName != "" || metadata.SourceURL != "" {
		if metadata.OriginalTitle != "" {
			builder.WriteString("**Original title**: ")
			builder.WriteString(markdownText(metadata.OriginalTitle))
			builder.WriteString("\n")
		}
		if metadata.Author != "" {
			builder.WriteString("**Author**: ")
			builder.WriteString(markdownText(metadata.Author))
			builder.WriteString("\n")
		}
		if metadata.SourceName != "" {
			builder.WriteString("**Source**: ")
			builder.WriteString(markdownText(metadata.SourceName))
			if metadata.SourceURL != "" {
				builder.WriteString(" ([link](")
				builder.WriteString(markdownURL(metadata.SourceURL))
				builder.WriteString("))")
			}
			builder.WriteString("\n")
		} else if metadata.SourceURL != "" {
			builder.WriteString("**Source URL**: ")
			builder.WriteString(markdownURL(metadata.SourceURL))
			builder.WriteString("\n")
		}
		if metadata.PublishedAt != "" {
			builder.WriteString("**Published**: ")
			builder.WriteString(markdownText(metadata.PublishedAt))
			builder.WriteString("\n")
		}
		builder.WriteString("\n")
	}
	for index, section := range content.Sections {
		builder.WriteString("## ")
		builder.WriteString(markdownText(section.Title))
		builder.WriteString("\n\n")
		for _, paragraph := range section.Paragraphs {
			builder.WriteString("> ")
			builder.WriteString(renderSegments(paragraph.Segments))
			builder.WriteString("\n>\n")
			builder.WriteString("> ")
			builder.WriteString(markdownText(paragraph.Translation))
			builder.WriteString("\n\n")
		}
		for _, vocabulary := range section.Vocabulary {
			builder.WriteString("* **")
			builder.WriteString(markdownText(vocabulary.Term))
			builder.WriteString("**")
			if vocabulary.BritishPhonetic != "" || vocabulary.AmericanPhonetic != "" {
				builder.WriteString(" 英 [")
				builder.WriteString(markdownText(vocabulary.BritishPhonetic))
				builder.WriteString("] / 美 [")
				builder.WriteString(markdownText(vocabulary.AmericanPhonetic))
				builder.WriteString("]")
			}
			builder.WriteByte('\n')
			definition := vocabulary.Definition
			if vocabulary.PartOfSpeech != "" {
				definition = vocabulary.PartOfSpeech + " " + definition
			}
			builder.WriteString("  * ")
			builder.WriteString(markdownText(definition))
			builder.WriteByte('\n')
			if vocabulary.Usage != "" {
				builder.WriteString("  * ")
				builder.WriteString(markdownText(vocabulary.Usage))
				builder.WriteByte('\n')
			}
			for _, example := range vocabulary.Examples {
				builder.WriteString("  * ")
				builder.WriteString(markdownText(example))
				builder.WriteByte('\n')
			}
		}
		if index < len(content.Sections)-1 {
			builder.WriteString("\n")
		}
	}
	return strings.TrimSpace(builder.String()) + "\n"
}

func markdownURL(value string) string {
	value = strings.NewReplacer(
		"\\", "%5C",
		"(", "%28",
		")", "%29",
		"<", "%3C",
		">", "%3E",
		" ", "%20",
	).Replace(value)
	return html.EscapeString(value)
}

func renderSegments(segments []agent.EnglishArticleSegment) string {
	var builder strings.Builder
	for _, segment := range segments {
		text := markdownText(segment.Text)
		if segment.Emphasized {
			builder.WriteString("<u>")
			builder.WriteString(text)
			builder.WriteString("</u>")
		} else {
			builder.WriteString(text)
		}
	}
	return builder.String()
}

func markdownText(value string) string {
	value = strings.ReplaceAll(value, "\r\n", " ")
	value = strings.ReplaceAll(value, "\r", " ")
	value = strings.ReplaceAll(value, "\n", " ")
	return strings.NewReplacer(
		"&", "&amp;",
		"<", "&lt;",
		">", "&gt;",
		"`", "&#96;",
		"*", "&#42;",
		"_", "&#95;",
		"[", "&#91;",
		"]", "&#93;",
		"#", "&#35;",
		"|", "&#124;",
	).Replace(value)
}

func yamlScalar(value string) string {
	value = cleanSpace(value)
	value = strings.ReplaceAll(value, "\\", "\\\\")
	value = strings.ReplaceAll(value, "\"", "\\\"")
	return `"` + value + `"`
}

func cleanSpace(value string) string {
	return strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
}

type articleError string

func (e articleError) Error() string { return string(e) }
