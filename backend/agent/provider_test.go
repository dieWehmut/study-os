package agent

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
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

func TestNetworkProvidersGiveUpOnAStalledVendor(t *testing.T) {
	// A vendor that accepts the connection and then never answers is
	// indistinguishable from a healthy one until the client gives up, and
	// http.DefaultClient never does. Free-text grading is the one place a
	// learner's answer reaches the vendor synchronously, so an unbounded call
	// there holds their request open until they close the tab.
	//
	// The real budget has to survive a slow reasoning model, which is far too
	// long to sit in a test, so lower it and assert the behaviour it buys.
	previous := defaultProviderTimeout
	defaultProviderTimeout = 100 * time.Millisecond
	t.Cleanup(func() { defaultProviderTimeout = previous })

	release := make(chan struct{})
	stalled := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		<-release
	}))
	// httptest's Close waits for handlers to return, so the release has to
	// happen first. Cleanups run last-registered-first.
	t.Cleanup(stalled.Close)
	t.Cleanup(func() { close(release) })

	vendor := VendorConfig{APIKey: "sk-test", BaseURL: stalled.URL, Model: "test-model"}
	// Both wire protocols share resolveProviderOptions, so cover both rather
	// than let one drift back to an unbounded client.
	builds := map[string]func() (Provider, error){
		"openai":    func() (Provider, error) { return NewOpenAIProvider("deepseek", vendor) },
		"anthropic": func() (Provider, error) { return NewAnthropicProvider("claude", vendor) },
	}
	request := Request{Kind: KindEvaluateFreeText, FreeText: &FreeTextInput{
		Question: "用 abandon 造句", Answer: "I abandon the old plan.",
	}}

	for name, build := range builds {
		t.Run(name, func(t *testing.T) {
			provider, err := build()
			if err != nil {
				t.Fatalf("construct provider: %v", err)
			}
			// context.Background() on purpose: the provider has to bound itself
			// rather than lean on whatever deadline the caller happened to set.
			done := make(chan error, 1)
			go func() {
				_, generateErr := provider.Generate(context.Background(), request)
				done <- generateErr
			}()
			select {
			case generateErr := <-done:
				if generateErr == nil {
					t.Fatal("stalled vendor returned success")
				}
				if class := ErrorClassOf(generateErr); class != ErrorTemporary {
					t.Fatalf("error class = %q, want %q so grading falls back offline", class, ErrorTemporary)
				}
			case <-time.After(5 * time.Second):
				t.Fatal("Generate never returned: the provider has no request timeout")
			}
		})
	}
}

// The wiki is the one field with no `omitempty`: it is the whole payload, and
// the four beside it are decoration. Decoding the lot into one struct means a
// vendor's reading of a decorative field decides whether the payload survives.
//
// DeepSeek really does answer `"memory_tips": "a-band-on ..."` -- a single tip
// is naturally a sentence, and the prompt never said otherwise. Against a
// []string that is a type error, so json.Unmarshal fails and every wiki this
// project ever asked DeepSeek for was thrown away with a 899-character
// detailed_markdown sitting inside it. 生成导图 reads that same markdown, so the
// map had nothing to draw either.
func TestWordWikiSurvivesAScalarWhereAListWasExpected(t *testing.T) {
	scalars := map[string]string{
		"memory_tips":  `{"detailed_markdown":"## abandon\n\n### 用法\n放弃。","memory_tips":"a-band-on 乐队抛下你"}`,
		"collocations": `{"detailed_markdown":"## abandon\n\n### 用法\n放弃。","collocations":"abandon ship"}`,
		"word_family":  `{"detailed_markdown":"## abandon\n\n### 用法\n放弃。","word_family":"abandoned"}`,
	}

	for field, content := range scalars {
		t.Run(field, func(t *testing.T) {
			response, err := decodeProviderOutput(KindWordWiki, content)
			if err != nil {
				t.Fatalf("decode: %v -- a decorative %s must not cost the wiki", err, field)
			}
			if response.WordWiki == nil || response.WordWiki.DetailedMarkdown == "" {
				t.Fatal("detailed_markdown was dropped")
			}
		})
	}
}

// A scalar is one item, not no items: dropping it silently would trade a decode
// failure for a quieter data loss.
func TestWordWikiReadsALoneTipAsAOneItemList(t *testing.T) {
	content := `{"detailed_markdown":"## abandon\n\n正文","memory_tips":"a-band-on 乐队抛下你"}`

	response, err := decodeProviderOutput(KindWordWiki, content)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got := response.WordWiki.MemoryTips; len(got) != 1 || got[0] != "a-band-on 乐队抛下你" {
		t.Fatalf("memory_tips = %#v, want the sentence kept as the only tip", got)
	}
}
