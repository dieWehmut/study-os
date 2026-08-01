// Package agent defines the provider boundary used by offline and future
// network-backed learning agents. Providers receive typed requests and return
// typed responses; queue workers can persist the request payload separately.
package agent

import (
	"context"
	"errors"
	"net/url"
	"strings"
	"time"
)

// Provider is the narrow boundary between application services and an AI
// implementation. Implementations must not mutate the request and should
// return a ProviderError for failures that can be classified by the queue.
type Provider interface {
	Name() string
	Generate(context.Context, Request) (Response, error)
}

// Kind identifies the small set of provider operations needed by v0.1.
type Kind string

const (
	KindMemoryQuestion Kind = "memory_question"
	KindFeedback       Kind = "feedback"
	KindSummary        Kind = "summary"
)

// Request is intentionally typed instead of accepting an arbitrary prompt.
// This keeps persisted jobs inspectable and gives a future provider a stable
// compatibility contract.
type Request struct {
	Kind      Kind            `json:"kind"`
	Knowledge *KnowledgeInput `json:"knowledge,omitempty"`
	Feedback  *FeedbackInput  `json:"feedback,omitempty"`
	Summary   *SummaryInput   `json:"summary,omitempty"`
}

type KnowledgeInput struct {
	ID              string   `json:"id"`
	Term            string   `json:"term"`
	Definition      string   `json:"definition"`
	Example         string   `json:"example,omitempty"`
	PromptType      string   `json:"prompt_type,omitempty"`
	AcceptedAnswers []string `json:"accepted_answers,omitempty"`
}

type FeedbackInput struct {
	Answer          string   `json:"answer"`
	AcceptedAnswers []string `json:"accepted_answers"`
}

type SummaryInput struct {
	Title        string `json:"title,omitempty"`
	Text         string `json:"text"`
	MaxKeyPoints int    `json:"max_key_points,omitempty"`
}

// Response contains exactly one operation-specific output for a successful
// request. The pointers make malformed mixed responses detectable by callers.
type Response struct {
	Kind           Kind                  `json:"kind"`
	MemoryQuestion *MemoryQuestionOutput `json:"memory_question,omitempty"`
	Feedback       *FeedbackOutput       `json:"feedback,omitempty"`
	Summary        *SummaryOutput        `json:"summary,omitempty"`
}

type MemoryQuestionOutput struct {
	KnowledgeID     string   `json:"knowledge_id"`
	PromptType      string   `json:"prompt_type"`
	Question        string   `json:"question"`
	AcceptedAnswers []string `json:"accepted_answers"`
	Hint            string   `json:"hint,omitempty"`
}

type FeedbackOutput struct {
	Outcome Outcome `json:"outcome"`
	Rating  Rating  `json:"rating"`
	Message string  `json:"message"`
}

type SummaryOutput struct {
	Title     string   `json:"title,omitempty"`
	KeyPoints []string `json:"key_points"`
	Abstract  string   `json:"abstract,omitempty"`
}

// Validate checks the operation/payload pairing before a provider is called.
// Invalid user data is permanent: retrying it cannot make it valid.
func (r Request) Validate() error {
	switch r.Kind {
	case KindMemoryQuestion:
		if r.Knowledge == nil || strings.TrimSpace(r.Knowledge.Term) == "" || strings.TrimSpace(r.Knowledge.Definition) == "" {
			return NewProviderError(ErrorPermanent, "memory question requires a term and definition")
		}
	case KindFeedback:
		if r.Feedback == nil || len(nonEmpty(r.Feedback.AcceptedAnswers)) == 0 {
			return NewProviderError(ErrorPermanent, "feedback requires at least one accepted answer")
		}
	case KindSummary:
		if r.Summary == nil || strings.TrimSpace(r.Summary.Text) == "" {
			return NewProviderError(ErrorPermanent, "summary requires text")
		}
	default:
		return NewProviderError(ErrorPermanent, "unsupported provider request kind")
	}
	return nil
}

func nonEmpty(values []string) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			result = append(result, value)
		}
	}
	return result
}

type Outcome string

const (
	OutcomeIncorrect Outcome = "incorrect"
	OutcomePartial   Outcome = "partial"
	OutcomeCorrect   Outcome = "correct"
)

type Rating int

const (
	RatingAgain Rating = iota + 1
	RatingHard
	RatingGood
)

// ErrorClass is deliberately independent of HTTP status codes. Queue policy
// can therefore be shared by a local provider and a future OpenAI adapter.
type ErrorClass string

const (
	ErrorConfigMissing ErrorClass = "config_missing"
	ErrorRateLimited   ErrorClass = "rate_limited"
	ErrorTemporary     ErrorClass = "temporary"
	ErrorPermanent     ErrorClass = "permanent"
	ErrorUnknown       ErrorClass = "unknown"
)

// ProviderError contains safe, user-facing context. Cause is kept for
// diagnostics but Error intentionally never formats it, preventing accidental
// propagation of credentials or transport internals.
type ProviderError struct {
	Class      ErrorClass
	Message    string
	RetryAfter time.Duration
	Cause      error
}

func NewProviderError(class ErrorClass, message string) *ProviderError {
	if class == "" {
		class = ErrorUnknown
	}
	if strings.TrimSpace(message) == "" {
		message = "provider request failed"
	}
	return &ProviderError{Class: class, Message: message}
}

func NewRateLimitError(message string, retryAfter time.Duration) *ProviderError {
	err := NewProviderError(ErrorRateLimited, message)
	if retryAfter > 0 {
		err.RetryAfter = retryAfter
	}
	return err
}

func (e *ProviderError) Error() string {
	if e == nil {
		return "provider error"
	}
	return e.Message
}

func (e *ProviderError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Cause
}

func ErrorClassOf(err error) ErrorClass {
	if err == nil {
		return ""
	}
	var providerErr *ProviderError
	if errors.As(err, &providerErr) && providerErr != nil && providerErr.Class != "" {
		return providerErr.Class
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return ErrorTemporary
	}
	return ErrorUnknown
}

func retryAfterOf(err error) time.Duration {
	var providerErr *ProviderError
	if errors.As(err, &providerErr) && providerErr != nil && providerErr.RetryAfter > 0 {
		return providerErr.RetryAfter
	}
	return 0
}

// RetryPolicy decides whether a failed attempt should remain in the queue.
// attempt is one-based (the attempt that just failed). Delays use capped
// exponential backoff; rate-limit responses can supply a larger Retry-After.
type RetryPolicy struct {
	MaxAttempts int
	BaseDelay   time.Duration
	MaxDelay    time.Duration
}

func (p RetryPolicy) normalized() RetryPolicy {
	if p.MaxAttempts <= 0 {
		p.MaxAttempts = 3
	}
	if p.BaseDelay <= 0 {
		p.BaseDelay = time.Second
	}
	if p.MaxDelay <= 0 {
		p.MaxDelay = 30 * time.Second
	}
	if p.MaxDelay < p.BaseDelay {
		p.MaxDelay = p.BaseDelay
	}
	return p
}

// Next returns the delay and whether another attempt is allowed.
func (p RetryPolicy) Next(err error, attempt int) (time.Duration, bool) {
	p = p.normalized()
	if attempt < 1 || attempt >= p.MaxAttempts {
		return 0, false
	}
	class := ErrorClassOf(err)
	if class != ErrorTemporary && class != ErrorRateLimited {
		return 0, false
	}
	if retryAfter := retryAfterOf(err); retryAfter > 0 {
		return retryAfter, true
	}
	delay := p.BaseDelay
	for retry := 1; retry < attempt; retry++ {
		if delay >= p.MaxDelay/2 {
			delay = p.MaxDelay
			break
		}
		delay *= 2
	}
	return delay, true
}

// OpenAIConfig is kept separate from the application config so the adapter
// can later be wired from environment-backed settings without exposing a key.
type OpenAIConfig struct {
	APIKey  string
	BaseURL string
	Model   string
}

func validateOpenAIConfig(cfg OpenAIConfig) error {
	if strings.TrimSpace(cfg.APIKey) == "" {
		return NewProviderError(ErrorConfigMissing, "OpenAI provider API key is not configured")
	}
	if strings.TrimSpace(cfg.BaseURL) == "" {
		return NewProviderError(ErrorConfigMissing, "OpenAI provider base URL is not configured")
	}
	parsed, err := url.Parse(cfg.BaseURL)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" || (parsed.Scheme != "https" && parsed.Scheme != "http") {
		return NewProviderError(ErrorPermanent, "OpenAI provider base URL is invalid")
	}
	if strings.TrimSpace(cfg.Model) == "" {
		return NewProviderError(ErrorConfigMissing, "OpenAI provider model is not configured")
	}
	return nil
}

// OpenAIProvider is the intentionally offline adapter stub for v0.1. Future
// work should add an injected HTTP transport here, translate request kinds to
// provider-specific JSON, classify status codes, and decode into Response. No
// network client is constructed by this package today.
type OpenAIProvider struct {
	baseURL string
	model   string
	apiKey  string
}

var _ Provider = (*OpenAIProvider)(nil)

func NewOpenAIProvider(cfg OpenAIConfig) (*OpenAIProvider, error) {
	if err := validateOpenAIConfig(cfg); err != nil {
		return nil, err
	}
	return &OpenAIProvider{baseURL: strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/"), model: strings.TrimSpace(cfg.Model), apiKey: cfg.APIKey}, nil
}

func (p *OpenAIProvider) Name() string { return "openai" }

func (p *OpenAIProvider) Generate(ctx context.Context, request Request) (Response, error) {
	if err := ctxErr(ctx); err != nil {
		return Response{}, err
	}
	if err := request.Validate(); err != nil {
		return Response{}, err
	}
	// Keep the key private and make the missing transport explicit. An HTTP
	// implementation can replace this method without changing callers.
	return Response{}, NewProviderError(ErrorPermanent, "OpenAI provider transport is not enabled in offline v0.1")
}

func ctxErr(ctx context.Context) error {
	if ctx == nil {
		return NewProviderError(ErrorPermanent, "provider context is nil")
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	return nil
}
