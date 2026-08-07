package agent

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"
)

func TestMockProviderGeneratesDeterministicMemoryQuestion(t *testing.T) {
	provider := NewMockProvider()
	request := Request{
		Kind: KindMemoryQuestion,
		Knowledge: &KnowledgeInput{
			ID:         "knowledge-abandon",
			Term:       "abandon",
			Definition: "to leave behind",
			Example:    "They abandoned the plan.",
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
		t.Fatalf("mock output is not deterministic:\nfirst=%#v\nsecond=%#v", first, second)
	}
	if first.Kind != KindMemoryQuestion || first.MemoryQuestion == nil {
		t.Fatalf("memory question response = %#v", first)
	}
	if first.MemoryQuestion.Question != `What does "abandon" mean?` {
		t.Fatalf("question = %q", first.MemoryQuestion.Question)
	}
	if first.MemoryQuestion.PromptType != "en_to_zh" {
		t.Fatalf("prompt type = %q", first.MemoryQuestion.PromptType)
	}
	if !reflect.DeepEqual(first.MemoryQuestion.AcceptedAnswers, []string{"to leave behind"}) {
		t.Fatalf("accepted answers = %#v", first.MemoryQuestion.AcceptedAnswers)
	}
}

func TestMockProviderGeneratesDeterministicFeedback(t *testing.T) {
	provider := NewMockProvider()
	request := Request{
		Kind: KindFeedback,
		Feedback: &FeedbackInput{
			Answer:          "to leave behind",
			AcceptedAnswers: []string{"to leave behind", "leave behind"},
		},
	}

	first, err := provider.Generate(context.Background(), request)
	if err != nil {
		t.Fatalf("first feedback: %v", err)
	}
	second, err := provider.Generate(context.Background(), request)
	if err != nil {
		t.Fatalf("second feedback: %v", err)
	}
	if !reflect.DeepEqual(first, second) {
		t.Fatalf("feedback is not deterministic: %#v != %#v", first, second)
	}
	if first.Feedback == nil || first.Feedback.Outcome != OutcomeCorrect {
		t.Fatalf("feedback = %#v", first.Feedback)
	}
	if first.Feedback.Rating != RatingGood || first.Feedback.Message == "" {
		t.Fatalf("feedback details = %#v", first.Feedback)
	}

	wrong, err := provider.Generate(context.Background(), Request{
		Kind: KindFeedback,
		Feedback: &FeedbackInput{
			Answer:          "to destroy",
			AcceptedAnswers: []string{"to leave behind"},
		},
	})
	if err != nil {
		t.Fatalf("wrong feedback: %v", err)
	}
	if wrong.Feedback == nil || wrong.Feedback.Outcome != OutcomeIncorrect || wrong.Feedback.Rating != RatingAgain {
		t.Fatalf("wrong feedback = %#v", wrong.Feedback)
	}
}

func TestMockProviderSummarizesTextWithoutNondeterminism(t *testing.T) {
	provider := NewMockProvider()
	request := Request{
		Kind: KindSummary,
		Summary: &SummaryInput{
			Title:        "Cell",
			Text:         "Cells are basic units. They contain genetic material. Organelles have roles.",
			MaxKeyPoints: 2,
		},
	}

	first, err := provider.Generate(context.Background(), request)
	if err != nil {
		t.Fatalf("first summary: %v", err)
	}
	second, err := provider.Generate(context.Background(), request)
	if err != nil {
		t.Fatalf("second summary: %v", err)
	}
	if !reflect.DeepEqual(first, second) {
		t.Fatalf("summary is not deterministic: %#v != %#v", first, second)
	}
	if first.Summary == nil || first.Summary.Title != "Cell" {
		t.Fatalf("summary = %#v", first.Summary)
	}
	if !reflect.DeepEqual(first.Summary.KeyPoints, []string{
		"Cells are basic units.",
		"They contain genetic material.",
	}) {
		t.Fatalf("key points = %#v", first.Summary.KeyPoints)
	}
}

func TestMockProviderRejectsInvalidRequestsAsPermanentErrors(t *testing.T) {
	provider := NewMockProvider()
	_, err := provider.Generate(context.Background(), Request{Kind: KindMemoryQuestion})
	if err == nil {
		t.Fatal("invalid request unexpectedly succeeded")
	}
	var providerErr *ProviderError
	if !errors.As(err, &providerErr) {
		t.Fatalf("error type = %T", err)
	}
	if providerErr.Class != ErrorPermanent {
		t.Fatalf("error class = %q", providerErr.Class)
	}
}

func TestProviderErrorClassificationAndRetryPolicy(t *testing.T) {
	policy := RetryPolicy{MaxAttempts: 3, BaseDelay: time.Second, MaxDelay: 2500 * time.Millisecond}
	tests := []struct {
		name      string
		err       error
		attempt   int
		wantRetry bool
		wantDelay time.Duration
	}{
		{name: "temporary first retry", err: NewProviderError(ErrorTemporary, "upstream unavailable"), attempt: 1, wantRetry: true, wantDelay: time.Second},
		{name: "temporary capped", err: NewProviderError(ErrorTemporary, "upstream unavailable"), attempt: 3, wantRetry: false},
		{name: "rate limit honors retry after", err: NewRateLimitError("slow down", 7*time.Second), attempt: 1, wantRetry: true, wantDelay: 7 * time.Second},
		{name: "configuration is not retryable", err: NewProviderError(ErrorConfigMissing, "provider is not configured"), attempt: 1, wantRetry: false},
		{name: "permanent is not retryable", err: NewProviderError(ErrorPermanent, "invalid payload"), attempt: 1, wantRetry: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := ErrorClassOf(test.err); got == ErrorUnknown {
				t.Fatalf("error class was not preserved: %v", test.err)
			}
			delay, retry := policy.Next(test.err, test.attempt)
			if retry != test.wantRetry {
				t.Fatalf("retry = %v, want %v", retry, test.wantRetry)
			}
			if test.wantRetry && delay != test.wantDelay {
				t.Fatalf("delay = %s, want %s", delay, test.wantDelay)
			}
		})
	}
}

// The factory dispatches on wire protocol rather than vendor name, so a new
// OpenAI-compatible vendor must work without any change to this package. These
// cases pin that: the vendor name is carried through to Name() untouched.
func TestNewProviderFactoryDispatchesOnStyle(t *testing.T) {
	mock, err := NewProvider(ProviderConfig{Active: ""})
	if err != nil {
		t.Fatalf("default mock provider: %v", err)
	}
	if mock.Name() != "mock" {
		t.Fatalf("mock provider name = %q", mock.Name())
	}

	tests := []struct {
		name   string
		active string
		style  string
		vendor VendorConfig
	}{
		{
			name:   "openai style",
			active: "deepseek",
			style:  StyleOpenAI,
			vendor: VendorConfig{APIKey: "test-secret", BaseURL: "https://api.deepseek.com/v1", Model: "deepseek-v4-flash"},
		},
		{
			name:   "unregistered openai compatible vendor",
			active: "some-new-vendor",
			style:  StyleOpenAI,
			vendor: VendorConfig{APIKey: "test-secret", BaseURL: "https://example.test/v1", Model: "some-model"},
		},
		{
			name:   "anthropic style",
			active: "claude",
			style:  StyleAnthropic,
			vendor: VendorConfig{APIKey: "test-secret", BaseURL: "https://api.anthropic.com/v1", Model: "claude-sonnet-4-6"},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			provider, err := NewProvider(ProviderConfig{Active: test.active, Style: test.style, Vendor: test.vendor})
			if err != nil {
				t.Fatalf("provider: %v", err)
			}
			if provider.Name() != test.active {
				t.Fatalf("provider name = %q, want %q", provider.Name(), test.active)
			}
		})
	}

	_, err = NewProvider(ProviderConfig{Active: "unknown-vendor"})
	if err == nil || ErrorClassOf(err) != ErrorConfigMissing {
		t.Fatalf("unknown style error = %v (class %q)", err, ErrorClassOf(err))
	}
}
