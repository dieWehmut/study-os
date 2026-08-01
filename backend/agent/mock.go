package agent

import (
	"context"
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
