package agent

import (
	"context"
	"fmt"
	"strings"
	"unicode"
)

// MockProvider is the default offline provider. It deliberately uses simple
// lexical rules so the same input always produces the same answer and can be
// safely used in tests, demos, and local study sessions without a network.
type MockProvider struct{}

var _ Provider = (*MockProvider)(nil)

func NewMockProvider() *MockProvider { return &MockProvider{} }

func (p *MockProvider) Name() string { return "mock" }

func (p *MockProvider) Generate(ctx context.Context, request Request) (Response, error) {
	if err := ctxErr(ctx); err != nil {
		return Response{}, err
	}
	if err := request.Validate(); err != nil {
		return Response{}, err
	}
	switch request.Kind {
	case KindMemoryQuestion:
		return p.memoryQuestion(*request.Knowledge), nil
	case KindFeedback:
		return p.feedback(*request.Feedback), nil
	case KindSummary:
		return p.summary(*request.Summary), nil
	case KindWordWiki:
		return p.wordWiki(*request.WordWiki), nil
	case KindMakeSentence:
		return p.makeSentence(*request.Sentence), nil
	case KindEvaluateFreeText:
		return p.evaluateFreeText(*request.FreeText), nil
	case KindExtractMemoryPoints:
		return p.extractMemoryPoints(*request.Extract), nil
	case KindCompressSenses:
		return p.compressSenses(*request.Compress), nil
	case KindChat:
		return p.chat(*request.Chat), nil
	case KindCompare:
		return p.compare(*request.Compare), nil
	case KindIntegrate:
		return p.integrate(*request.Integrate), nil
	case KindEnglishArticle:
		return p.englishArticle(*request.EnglishArticle), nil
	default:
		// Validate currently makes this unreachable; retaining a classified error
		// protects callers if new kinds are added without an implementation.
		return Response{}, NewProviderError(ErrorPermanent, "unsupported provider request kind")
	}
}

func (p *MockProvider) memoryQuestion(input KnowledgeInput) Response {
	promptType := strings.TrimSpace(input.PromptType)
	if promptType == "" {
		promptType = "en_to_zh"
	}
	accepted := cleanAnswers(input.AcceptedAnswers)
	if len(accepted) == 0 {
		accepted = []string{strings.TrimSpace(input.Definition)}
	}
	question := `What does "` + strings.TrimSpace(input.Term) + `" mean?`
	hint := strings.TrimSpace(input.Example)
	if hint != "" {
		hint = "Context: " + hint
	}
	return Response{
		Kind: KindMemoryQuestion,
		MemoryQuestion: &MemoryQuestionOutput{
			KnowledgeID:     strings.TrimSpace(input.ID),
			PromptType:      promptType,
			Question:        question,
			AcceptedAnswers: accepted,
			Hint:            hint,
		},
	}
}

func (p *MockProvider) feedback(input FeedbackInput) Response {
	answer := normalize(input.Answer)
	accepted := cleanAnswers(input.AcceptedAnswers)
	outcome := OutcomeIncorrect
	rating := RatingAgain
	message := "Not quite. Review the expected answer and try again."
	if answer != "" {
		for _, expected := range accepted {
			if answer == normalize(expected) {
				outcome = OutcomeCorrect
				rating = RatingGood
				message = "Correct. Keep this association active."
				break
			}
		}
		if outcome == OutcomeIncorrect {
			for _, expected := range accepted {
				normalized := normalize(expected)
				if normalized != "" && (strings.Contains(normalized, answer) || strings.Contains(answer, normalized)) {
					outcome = OutcomePartial
					rating = RatingHard
					message = "Close. Add the missing part, then reinforce it once more."
					break
				}
			}
		}
	}
	return Response{
		Kind:     KindFeedback,
		Feedback: &FeedbackOutput{Outcome: outcome, Rating: rating, Message: message},
	}
}

func (p *MockProvider) summary(input SummaryInput) Response {
	points := sentences(input.Text)
	max := input.MaxKeyPoints
	if max <= 0 {
		max = 3
	}
	if len(points) > max {
		points = points[:max]
	}
	title := strings.TrimSpace(input.Title)
	abstract := ""
	if len(points) > 0 {
		abstract = points[0]
	}
	return Response{
		Kind:    KindSummary,
		Summary: &SummaryOutput{Title: title, KeyPoints: points, Abstract: abstract},
	}
}

func (p *MockProvider) wordWiki(input WordWikiInput) Response {
	markdown := "## " + strings.TrimSpace(input.Term) + "\n\n"
	markdown += "**释义**：" + strings.TrimSpace(input.Definition) + "\n"
	if strings.TrimSpace(input.PartOfSpeech) != "" {
		markdown += "**词性**：" + strings.TrimSpace(input.PartOfSpeech) + "\n"
	}
	if strings.TrimSpace(input.Example) != "" {
		markdown += "**例句**：" + strings.TrimSpace(input.Example) + "\n"
	}
	markdown += "**记忆提示**：把「" + strings.TrimSpace(input.Term) + "」与「" + strings.TrimSpace(input.Definition) + "」绑定记忆。\n"
	markdown += "**词族**：" + strings.TrimSpace(input.Term) + "（核心词）\n"
	return Response{
		Kind: KindWordWiki,
		WordWiki: &WordWikiOutput{
			DetailedMarkdown:  markdown,
			ConciseDefinition: strings.TrimSpace(input.Definition),
			MemoryTips:        []string{"把词义和语境例句一起记，比孤立记更牢。"},
			Collocations:      []string{},
			WordFamily:        []string{strings.TrimSpace(input.Term)},
		},
	}
}

func (p *MockProvider) makeSentence(input SentenceInput) Response {
	term := strings.TrimSpace(input.Term)
	definition := strings.TrimSpace(input.Definition)
	if definition == "" {
		definition = "something"
	}
	sentence := `"` + term + `" is a word I am learning, and it means ` + definition + "."
	blanked := strings.Replace(sentence, term, "_____", 1)
	return Response{
		Kind: KindMakeSentence,
		Sentence: &SentenceOutput{
			Sentence:    sentence,
			Translation: "我正在学习单词“" + term + "”，它表示" + definition + "。",
			Blanked:     blanked,
		},
	}
}

func (p *MockProvider) evaluateFreeText(input FreeTextInput) Response {
	answer := normalize(input.Answer)
	if answer == "" {
		return Response{
			Kind: KindEvaluateFreeText,
			Feedback: &FeedbackOutput{
				Outcome: OutcomeIncorrect,
				Rating:  RatingAgain,
				Message: "还没有作答；先写出你的句子，再对照参考答案。",
			},
		}
	}
	accepted := cleanAnswers(input.AcceptedAnswers)
	if len(accepted) > 0 {
		for _, expected := range accepted {
			if answer == normalize(expected) {
				return Response{
					Kind: KindEvaluateFreeText,
					Feedback: &FeedbackOutput{
						Outcome: OutcomeCorrect,
						Rating:  RatingGood,
						Message: "正确。这个句子可以进入下一轮复习。",
					},
				}
			}
		}
		for _, expected := range accepted {
			normalized := normalize(expected)
			if normalized != "" && (strings.Contains(normalized, answer) || strings.Contains(answer, normalized)) {
				return Response{
					Kind: KindEvaluateFreeText,
					Feedback: &FeedbackOutput{
						Outcome: OutcomePartial,
						Rating:  RatingHard,
						Message: "接近参考答案，补充细节后再巩固一次。",
					},
				}
			}
		}
	}
	return Response{
		Kind: KindEvaluateFreeText,
		Feedback: &FeedbackOutput{
			Outcome: OutcomePartial,
			Rating:  RatingHard,
			Message: "离线模式无法逐句评判，已记录你的答案并标记为部分掌握；联网后可用 AI 批改。",
		},
	}
}

func (p *MockProvider) extractMemoryPoints(input ExtractInput) Response {
	text := strings.TrimSpace(input.Text)
	maxPoints := input.MaxPoints
	if maxPoints <= 0 {
		maxPoints = 20
	}
	points := make([]MemoryPointOutput, 0, maxPoints)
	if containsCJK(text) {
		for _, part := range splitSentences(text) {
			if len(points) >= maxPoints {
				break
			}
			points = append(points, MemoryPointOutput{
				Term:     part,
				ItemType: "sentence",
				Tags:     []string{"auto_extract", normalizeToken(input.Subject)},
			})
		}
	} else {
		seen := make(map[string]struct{})
		for _, token := range strings.FieldsFunc(strings.ToLower(text), func(r rune) bool {
			return !unicode.IsLetter(r) && r != '\''
		}) {
			if len(points) >= maxPoints {
				break
			}
			if len(token) < 4 {
				continue
			}
			if _, exists := seen[token]; exists {
				continue
			}
			seen[token] = struct{}{}
			points = append(points, MemoryPointOutput{
				Term:     token,
				ItemType: "word_sense",
				Tags:     []string{"auto_extract", normalizeToken(input.Subject)},
			})
		}
	}
	return Response{Kind: KindExtractMemoryPoints, Extract: &ExtractOutput{Points: points}}
}

func (p *MockProvider) compressSenses(input CompressInput) Response {
	groups := make([]SenseGroupOutput, 0)
	groupByPrefix := make(map[string]int)
	for _, sense := range input.Senses {
		definition := strings.TrimSpace(sense.Definition)
		if definition == "" {
			continue
		}
		prefix := runePrefix(definition, 4)
		index, exists := groupByPrefix[prefix]
		if !exists {
			index = len(groups)
			groupByPrefix[prefix] = index
			groups = append(groups, SenseGroupOutput{
				Name:             prefix,
				MergedDefinition: definition,
			})
		}
		groups[index].SenseIndexes = append(groups[index].SenseIndexes, sense.Index)
	}
	return Response{Kind: KindCompressSenses, Compress: &CompressOutput{Groups: groups}}
}

func (p *MockProvider) chat(input ChatInput) Response {
	subject := strings.TrimSpace(input.Subject)
	if subject == "" {
		subject = "综合"
	}
	subject = subjectChineseName(subject)
	return Response{
		Kind: KindChat,
		Chat: &ChatOutput{
			Answer: "（离线模式）已收到你在「" + subject + "」下的问题：" + strings.TrimSpace(input.Prompt) +
				"\n\n联网配置 AI 服务商后，我会结合学科知识给出详细解答。",
		},
	}
}

func subjectChineseName(subject string) string {
	switch strings.ToLower(strings.TrimSpace(subject)) {
	case "chinese":
		return "语文"
	case "math":
		return "数学"
	case "english":
		return "英语"
	case "physics":
		return "物理"
	case "chemistry":
		return "化学"
	case "geography":
		return "地理"
	case "all":
		return "综合"
	default:
		return subject
	}
}

func (p *MockProvider) compare(input CompareInput) Response {
	subject := strings.TrimSpace(input.Subject)
	if subject == "" {
		subject = "综合"
	}
	termA := strings.TrimSpace(input.TermA)
	termB := strings.TrimSpace(input.TermB)
	return Response{
		Kind: KindCompare,
		Compare: &CompareOutput{
			Summary: "「" + termA + "」与「" + termB + "」的对比（离线模式生成；联网后可获得更详细辨析）。",
			SamePoints: []string{
				"都属于「" + subject + "」需要掌握的知识点",
				"考试中常以辨析/选择形式出现",
			},
			DiffPoints: []string{
				termA + "：" + termA + "的核心含义",
				termB + "：" + termB + "的核心含义",
			},
			ConfusionPoint: "注意区分两者的适用条件与易混表述。",
			MemoryTip:      "先抓一个关键差异，再对比复习，别两个一起硬背。",
		},
	}
}

func (p *MockProvider) integrate(input IntegrateInput) Response {
	title := strings.TrimSpace(input.Title)
	if title == "" {
		title = strings.TrimSpace(input.Subject) + " 整合笔记"
	}
	maxCards := input.MaxCards
	if maxCards <= 0 {
		maxCards = 8
	}
	sentences := splitSentences(strings.TrimSpace(input.Text))
	if len(sentences) > 6 {
		sentences = sentences[:6]
	}
	nodes := []MindNodeOutput{{ID: "n0", Label: truncateRunes(title, 20), NodeType: "root"}}
	cards := make([]CardOutput, 0, len(sentences))
	for index, sentence := range sentences {
		nodeID := fmt.Sprintf("n%d", index+1)
		label := truncateRunes(sentence, 20)
		nodes = append(nodes, MindNodeOutput{ID: nodeID, Label: label, ParentID: "n0", NodeType: "branch"})
		cards = append(cards, CardOutput{
			ID:       "c" + nodeID,
			CardType: "concept",
			Title:    label,
			Body:     sentence,
			Tags:     []string{normalizeToken(input.Subject)},
		})
		if index < 2 {
			parts := strings.FieldsFunc(sentence, func(r rune) bool {
				return r == '，' || r == ',' || r == '；' || r == ';'
			})
			subIndex := 1
			for _, part := range parts {
				part = strings.TrimSpace(part)
				if part == "" {
					continue
				}
				subID := fmt.Sprintf("n%d-%d", index+1, subIndex)
				nodes = append(nodes, MindNodeOutput{
					ID: subID, Label: truncateRunes(part, 20), ParentID: nodeID, NodeType: "leaf",
				})
				subIndex++
				if subIndex > 2 {
					break
				}
			}
		}
		if len(cards) >= maxCards {
			break
		}
	}
	return Response{
		Kind: KindIntegrate,
		Integrate: &IntegrateOutput{
			Map:   MindMapOutput{Title: title, Nodes: nodes},
			Cards: cards,
		},
	}
}

func (p *MockProvider) englishArticle(input EnglishArticleInput) Response {
	paragraphs := sentences(strings.TrimSpace(input.OriginalText))
	if len(paragraphs) == 0 {
		paragraphs = []string{strings.TrimSpace(input.OriginalText)}
	}
	title := strings.TrimSpace(input.OriginalTitle)
	if strings.TrimSpace(input.Title) != "" {
		title = strings.TrimSpace(input.Title)
	}
	if title == "" {
		title = "English Reading Notes"
	}
	sectionCount := min(2, len(paragraphs))
	sections := make([]EnglishArticleSection, 0, sectionCount)
	for index := 0; index < sectionCount; index++ {
		start := index * len(paragraphs) / sectionCount
		end := (index + 1) * len(paragraphs) / sectionCount
		sectionParagraphs := make([]EnglishArticleParagraph, 0, end-start)
		vocabulary := []EnglishArticleVocabulary{}
		for _, sourceParagraph := range paragraphs[start:end] {
			text := strings.TrimSpace(sourceParagraph)
			sectionParagraphs = append(sectionParagraphs, EnglishArticleParagraph{
				Segments: mockArticleSegments(text), Translation: "这是对应英文段落的离线示例翻译。",
			})
			if term := firstLearningWord(text); term != "" {
				vocabulary = append(vocabulary, EnglishArticleVocabulary{
					Term: term, PartOfSpeech: "word", Definition: "离线示例释义",
					Usage: "在上下文中理解并复述这个词。", Examples: []string{text},
				})
			}
		}
		sections = append(sections, EnglishArticleSection{
			Title:      fmt.Sprintf("%d. Reading focus", index+1),
			Paragraphs: sectionParagraphs,
			Vocabulary: vocabulary,
		})
	}
	return Response{Kind: KindEnglishArticle, EnglishArticle: &EnglishArticleOutput{
		Title: title,
		Metadata: EnglishArticleMetadata{
			OriginalTitle: strings.TrimSpace(input.OriginalTitle), Author: strings.TrimSpace(input.Author),
			SourceName: strings.TrimSpace(input.SourceName), SourceURL: strings.TrimSpace(input.SourceURL), PublishedAt: strings.TrimSpace(input.PublishedAt),
		},
		Sections: sections,
	}}
}

func mockArticleSegments(text string) []EnglishArticleSegment {
	fields := strings.Fields(text)
	if len(fields) < 2 {
		return []EnglishArticleSegment{{Text: text, Emphasized: true}}
	}
	first := fields[0]
	remainderIndex := strings.Index(text, first) + len(first)
	return []EnglishArticleSegment{
		{Text: text[:remainderIndex] + " ", Emphasized: true},
		{Text: strings.TrimLeft(text[remainderIndex:], " ")},
	}
}

func firstLearningWord(text string) string {
	for _, field := range strings.FieldsFunc(text, func(r rune) bool { return !unicode.IsLetter(r) && r != '\'' }) {
		if len([]rune(field)) >= 5 {
			return strings.ToLower(field)
		}
	}
	return ""
}

func truncateRunes(value string, limit int) string {
	runes := []rune(strings.TrimSpace(value))
	if len(runes) <= limit {
		return string(runes)
	}
	return string(runes[:limit]) + "…"
}

func containsCJK(value string) bool {
	for _, r := range value {
		if unicode.Is(unicode.Han, r) {
			return true
		}
	}
	return false
}

func splitSentences(value string) []string {
	result := make([]string, 0)
	start := 0
	for index, r := range value {
		switch r {
		case '。', '！', '？', '；', '\n':
			part := strings.TrimSpace(value[start:index])
			if part != "" {
				result = append(result, part)
			}
			start = index + len(string(r))
		}
	}
	if tail := strings.TrimSpace(value[start:]); tail != "" {
		result = append(result, tail)
	}
	return result
}

func runePrefix(value string, count int) string {
	runes := []rune(value)
	if len(runes) <= count {
		return string(runes)
	}
	return string(runes[:count])
}

func normalizeToken(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	return strings.Join(strings.Fields(value), "_")
}

func cleanAnswers(values []string) []string {
	result := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		key := normalize(value)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		result = append(result, value)
	}
	return result
}

func normalize(value string) string {
	return strings.Map(func(r rune) rune {
		if unicode.IsSpace(r) || unicode.IsPunct(r) {
			return -1
		}
		return unicode.ToLower(r)
	}, strings.TrimSpace(value))
}

func sentences(text string) []string {
	text = strings.TrimSpace(text)
	if text == "" {
		return nil
	}
	result := make([]string, 0, 3)
	start := 0
	for index, r := range text {
		if r != '.' && r != '!' && r != '?' && r != '\u3002' && r != '\uff01' && r != '\uff1f' {
			continue
		}
		part := strings.TrimSpace(text[start : index+len(string(r))])
		if part != "" {
			result = append(result, part)
		}
		start = index + len(string(r))
	}
	if tail := strings.TrimSpace(text[start:]); tail != "" {
		result = append(result, tail)
	}
	return result
}
