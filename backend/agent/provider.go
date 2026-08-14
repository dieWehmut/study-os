// Package agent defines the provider boundary used by offline and network
// backed learning agents. Providers receive typed requests and return typed
// responses; queue workers can persist the request payload separately.
package agent

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
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

// Kind identifies the small set of provider operations supported by the
// application. Keep it closed: new capabilities get a new typed kind plus a
// mock implementation so offline behavior stays deterministic.
type Kind string

const (
	KindMemoryQuestion      Kind = "memory_question"
	KindFeedback            Kind = "feedback"
	KindSummary             Kind = "summary"
	KindWordWiki            Kind = "word_wiki"
	KindMakeSentence        Kind = "make_sentence"
	KindEvaluateFreeText    Kind = "evaluate_free_text"
	KindExtractMemoryPoints Kind = "extract_memory_points"
	KindCompressSenses      Kind = "compress_senses"
	KindChat                Kind = "chat"
	KindCompare             Kind = "compare"
	KindIntegrate           Kind = "integrate"
	KindEnglishArticle      Kind = "english_article"
)

// Options carries per-request provider hints. Empty values mean the provider
// defaults apply.
type Options struct {
	Model           string `json:"model,omitempty"`
	Thinking        string `json:"thinking,omitempty"`
	ReasoningEffort string `json:"reasoning_effort,omitempty"`
}

// Request is intentionally typed instead of accepting an arbitrary prompt.
// This keeps persisted jobs inspectable and gives a future provider a stable
// compatibility contract.
type Request struct {
	Kind           Kind                 `json:"kind"`
	Options        Options              `json:"options,omitempty"`
	Knowledge      *KnowledgeInput      `json:"knowledge,omitempty"`
	Feedback       *FeedbackInput       `json:"feedback,omitempty"`
	Summary        *SummaryInput        `json:"summary,omitempty"`
	WordWiki       *WordWikiInput       `json:"word_wiki,omitempty"`
	Sentence       *SentenceInput       `json:"sentence,omitempty"`
	FreeText       *FreeTextInput       `json:"free_text,omitempty"`
	Extract        *ExtractInput        `json:"extract,omitempty"`
	Compress       *CompressInput       `json:"compress,omitempty"`
	Chat           *ChatInput           `json:"chat,omitempty"`
	Compare        *CompareInput        `json:"compare,omitempty"`
	Integrate      *IntegrateInput      `json:"integrate,omitempty"`
	EnglishArticle *EnglishArticleInput `json:"english_article,omitempty"`
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

type WordWikiInput struct {
	ID           string   `json:"id,omitempty"`
	Term         string   `json:"term"`
	PartOfSpeech string   `json:"part_of_speech,omitempty"`
	Definition   string   `json:"definition"`
	Example      string   `json:"example,omitempty"`
	Level        string   `json:"level,omitempty"`
	Tags         []string `json:"tags,omitempty"`
	SenseGroup   string   `json:"sense_group,omitempty"`
}

type SentenceInput struct {
	Term       string `json:"term"`
	Definition string `json:"definition,omitempty"`
	Example    string `json:"example,omitempty"`
	Level      string `json:"level,omitempty"`
}

type FreeTextInput struct {
	Question        string   `json:"question"`
	Answer          string   `json:"answer"`
	PromptType      string   `json:"prompt_type,omitempty"`
	AcceptedAnswers []string `json:"accepted_answers,omitempty"`
	Criteria        string   `json:"criteria,omitempty"`
}

type ExtractInput struct {
	Title     string `json:"title,omitempty"`
	Subject   string `json:"subject,omitempty"`
	Text      string `json:"text"`
	MaxPoints int    `json:"max_points,omitempty"`
}

type CompressInput struct {
	Term   string       `json:"term"`
	Senses []SenseInput `json:"senses"`
}

type SenseInput struct {
	Index      int      `json:"index"`
	Definition string   `json:"definition"`
	Tags       []string `json:"tags,omitempty"`
}

type ChatTurn struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type ChatInput struct {
	Subject string     `json:"subject"`
	Prompt  string     `json:"prompt"`
	History []ChatTurn `json:"history,omitempty"`
}

type CompareInput struct {
	Subject string `json:"subject"`
	TermA   string `json:"term_a"`
	TermB   string `json:"term_b"`
}

type IntegrateInput struct {
	Subject  string `json:"subject"`
	Title    string `json:"title,omitempty"`
	Text     string `json:"text"`
	MaxCards int    `json:"max_cards,omitempty"`
}

// EnglishArticleInput contains the user-authored source and optional factual
// metadata. Providers may improve the presentation, but must not overwrite
// metadata that the user supplied.
type EnglishArticleInput struct {
	OriginalText  string `json:"original_text"`
	Title         string `json:"title,omitempty"`
	OriginalTitle string `json:"original_title,omitempty"`
	Author        string `json:"author,omitempty"`
	SourceName    string `json:"source_name,omitempty"`
	SourceURL     string `json:"source_url,omitempty"`
	PublishedAt   string `json:"published_at,omitempty"`
}

// Response contains exactly one operation-specific output for a successful
// request. The pointers make malformed mixed responses detectable by callers.
type Response struct {
	Kind           Kind                  `json:"kind"`
	MemoryQuestion *MemoryQuestionOutput `json:"memory_question,omitempty"`
	Feedback       *FeedbackOutput       `json:"feedback,omitempty"`
	Summary        *SummaryOutput        `json:"summary,omitempty"`
	WordWiki       *WordWikiOutput       `json:"word_wiki,omitempty"`
	Sentence       *SentenceOutput       `json:"sentence,omitempty"`
	Extract        *ExtractOutput        `json:"extract,omitempty"`
	Compress       *CompressOutput       `json:"compress,omitempty"`
	Chat           *ChatOutput           `json:"chat,omitempty"`
	Compare        *CompareOutput        `json:"compare,omitempty"`
	Integrate      *IntegrateOutput      `json:"integrate,omitempty"`
	EnglishArticle *EnglishArticleOutput `json:"english_article,omitempty"`
}

type MemoryQuestionOutput struct {
	KnowledgeID     string   `json:"knowledge_id"`
	PromptType      string   `json:"prompt_type"`
	Question        string   `json:"question"`
	AcceptedAnswers []string `json:"accepted_answers"`
	Hint            string   `json:"hint,omitempty"`
}

type FeedbackOutput struct {
	Outcome      Outcome `json:"outcome"`
	Rating       Rating  `json:"rating"`
	Message      string  `json:"message"`
	SampleAnswer string  `json:"sample_answer,omitempty"`
}

type SummaryOutput struct {
	Title     string   `json:"title,omitempty"`
	KeyPoints []string `json:"key_points"`
	Abstract  string   `json:"abstract,omitempty"`
}

type WordWikiOutput struct {
	DetailedMarkdown  string     `json:"detailed_markdown"`
	ConciseDefinition string     `json:"concise_definition,omitempty"`
	MemoryTips        stringList `json:"memory_tips,omitempty"`
	Collocations      stringList `json:"collocations,omitempty"`
	WordFamily        stringList `json:"word_family,omitempty"`
}

// stringList accepts either a JSON array of strings or a bare string, because a
// model asked for "tips" that has exactly one tip writes a sentence rather than
// a one-element array -- and that reading of the prompt is not wrong.
//
// Against a plain []string that is a type error, and json.Unmarshal fails the
// *whole object*. These fields share a struct with detailed_markdown, the only
// field without omitempty because it is the entire payload; so the shape a
// vendor chose for a decoration decided whether the wiki survived. DeepSeek
// answers memory_tips as a sentence every time, so word-wiki generation failed
// 100% against it, discarding a complete ~900-character wiki on every call.
// 生成导图 reads that same markdown, so the map had nothing to draw either.
type stringList []string

func (l *stringList) UnmarshalJSON(data []byte) error {
	trimmed := strings.TrimSpace(string(data))
	if trimmed == "" || trimmed == "null" {
		*l = nil
		return nil
	}
	if trimmed[0] == '[' {
		var items []string
		if err := json.Unmarshal(data, &items); err != nil {
			return err
		}
		*l = items
		return nil
	}
	var single string
	if err := json.Unmarshal(data, &single); err != nil {
		return err
	}
	// One sentence is one item, not none. Silently dropping it would trade a
	// loud decode failure for a quiet data loss, which is the harder bug.
	if strings.TrimSpace(single) == "" {
		*l = nil
		return nil
	}
	*l = stringList{single}
	return nil
}

type SentenceOutput struct {
	Sentence    string `json:"sentence"`
	Translation string `json:"translation,omitempty"`
	Blanked     string `json:"blanked,omitempty"`
}

type ExtractOutput struct {
	Points []MemoryPointOutput `json:"points"`
}

type MemoryPointOutput struct {
	Term       string   `json:"term"`
	Definition string   `json:"definition,omitempty"`
	ItemType   string   `json:"item_type"`
	Level      string   `json:"level,omitempty"`
	Tags       []string `json:"tags,omitempty"`
}

type CompressOutput struct {
	Groups []SenseGroupOutput `json:"groups"`
}

type SenseGroupOutput struct {
	Name             string `json:"name"`
	SenseIndexes     []int  `json:"sense_indexes"`
	MergedDefinition string `json:"merged_definition"`
}

type ChatOutput struct {
	Answer string `json:"answer"`
}

type CompareOutput struct {
	Summary        string   `json:"summary"`
	SamePoints     []string `json:"same_points,omitempty"`
	DiffPoints     []string `json:"diff_points,omitempty"`
	ConfusionPoint string   `json:"confusion_point,omitempty"`
	MemoryTip      string   `json:"memory_tip,omitempty"`
}

type MindNodeOutput struct {
	ID       string `json:"id"`
	Label    string `json:"label"`
	ParentID string `json:"parent_id,omitempty"`
	NodeType string `json:"node_type,omitempty"`
}

type MindMapOutput struct {
	Title string           `json:"title"`
	Nodes []MindNodeOutput `json:"nodes"`
}

type CardOutput struct {
	ID       string   `json:"id"`
	CardType string   `json:"card_type"`
	Title    string   `json:"title"`
	Body     string   `json:"body"`
	Tags     []string `json:"tags,omitempty"`
}

type IntegrateOutput struct {
	Map   MindMapOutput `json:"mindmap"`
	Cards []CardOutput  `json:"cards"`
}

// EnglishArticleOutput is the provider's structured bilingual reading
// article. The service layer validates and turns it into canonical Markdown.
type EnglishArticleOutput struct {
	Title    string                  `json:"title"`
	Metadata EnglishArticleMetadata  `json:"metadata"`
	Sections []EnglishArticleSection `json:"sections"`
}

// EnglishArticleContent is kept as a semantic alias for callers that treat
// the provider result as the article content persisted by the service.
type EnglishArticleContent = EnglishArticleOutput

type EnglishArticleMetadata struct {
	OriginalTitle string `json:"original_title,omitempty"`
	Author        string `json:"author,omitempty"`
	SourceName    string `json:"source_name,omitempty"`
	SourceURL     string `json:"source_url,omitempty"`
	PublishedAt   string `json:"published_at,omitempty"`
}

type EnglishArticleSection struct {
	Title      string                     `json:"title"`
	Paragraphs []EnglishArticleParagraph  `json:"paragraphs"`
	Vocabulary []EnglishArticleVocabulary `json:"vocabulary,omitempty"`
}

type EnglishArticleParagraph struct {
	Segments    []EnglishArticleSegment `json:"segments"`
	Translation string                  `json:"translation"`
}

type EnglishArticleSegment struct {
	Text       string `json:"text"`
	Emphasized bool   `json:"emphasized,omitempty"`
}

type EnglishArticleVocabulary struct {
	Term             string   `json:"term"`
	BritishPhonetic  string   `json:"british_phonetic,omitempty"`
	AmericanPhonetic string   `json:"american_phonetic,omitempty"`
	PartOfSpeech     string   `json:"part_of_speech,omitempty"`
	Definition       string   `json:"definition"`
	Usage            string   `json:"usage,omitempty"`
	Examples         []string `json:"examples,omitempty"`
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
	case KindWordWiki:
		if r.WordWiki == nil || strings.TrimSpace(r.WordWiki.Term) == "" || strings.TrimSpace(r.WordWiki.Definition) == "" {
			return NewProviderError(ErrorPermanent, "word wiki requires a term and definition")
		}
	case KindMakeSentence:
		if r.Sentence == nil || strings.TrimSpace(r.Sentence.Term) == "" {
			return NewProviderError(ErrorPermanent, "sentence generation requires a term")
		}
	case KindEvaluateFreeText:
		if r.FreeText == nil || strings.TrimSpace(r.FreeText.Question) == "" {
			return NewProviderError(ErrorPermanent, "free text evaluation requires a question")
		}
	case KindExtractMemoryPoints:
		if r.Extract == nil || strings.TrimSpace(r.Extract.Text) == "" {
			return NewProviderError(ErrorPermanent, "memory point extraction requires text")
		}
	case KindCompressSenses:
		if r.Compress == nil || strings.TrimSpace(r.Compress.Term) == "" || len(r.Compress.Senses) == 0 {
			return NewProviderError(ErrorPermanent, "sense compression requires a term and at least one sense")
		}
	case KindChat:
		if r.Chat == nil || strings.TrimSpace(r.Chat.Prompt) == "" {
			return NewProviderError(ErrorPermanent, "chat requires a prompt")
		}
	case KindCompare:
		if r.Compare == nil || strings.TrimSpace(r.Compare.TermA) == "" || strings.TrimSpace(r.Compare.TermB) == "" {
			return NewProviderError(ErrorPermanent, "compare requires two terms")
		}
	case KindIntegrate:
		if r.Integrate == nil || strings.TrimSpace(r.Integrate.Text) == "" {
			return NewProviderError(ErrorPermanent, "integrate requires text")
		}
	case KindEnglishArticle:
		if r.EnglishArticle == nil || strings.TrimSpace(r.EnglishArticle.OriginalText) == "" {
			return NewProviderError(ErrorPermanent, "English article generation requires original text")
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
// can therefore be shared by a local provider and a remote adapter.
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

// VendorConfig is the per-vendor configuration for a network backed provider.
// Secrets are read from the process environment and never persisted.
type VendorConfig struct {
	APIKey         string
	BaseURL        string
	Model          string
	ReasoningModel string
}

// Wire protocol names. Every hosted vendor Study OS supports speaks one of
// these, so adding a vendor is a config change rather than a new provider.
const (
	StyleMock      = "mock"
	StyleOpenAI    = "openai"
	StyleAnthropic = "anthropic"
)

// ProviderConfig selects the active vendor and carries its resolved settings.
// Style picks the wire protocol, which is what lets a new OpenAI-compatible
// vendor work without touching this package.
type ProviderConfig struct {
	Active string
	Style  string
	Vendor VendorConfig
}

// NewProvider builds the provider for the active vendor. Unknown vendors and
// unrecognised wire protocols return a classified configuration error.
func NewProvider(cfg ProviderConfig) (Provider, error) {
	name := strings.ToLower(strings.TrimSpace(cfg.Active))
	if name == "" || name == StyleMock {
		return NewMockProvider(), nil
	}
	switch strings.ToLower(strings.TrimSpace(cfg.Style)) {
	case StyleMock:
		return NewMockProvider(), nil
	case StyleOpenAI:
		return NewOpenAIProvider(name, cfg.Vendor)
	case StyleAnthropic:
		return NewAnthropicProvider(name, cfg.Vendor)
	default:
		return nil, NewProviderError(ErrorConfigMissing, "configured AI provider is unsupported")
	}
}

// ProviderOption tweaks a network backed provider at construction time.
// Options are shared across wire protocols, so they carry settings rather than
// mutating a concrete provider type.
type ProviderOption func(*providerOptions)

type providerOptions struct {
	httpClient *http.Client
}

// defaultProviderTimeout bounds a single vendor round trip. http.DefaultClient,
// the previous default, has no timeout at all: a vendor that accepts the
// connection and then stalls would hold a review answer open until the learner
// closed the tab, and the offline grading fallback -- which only runs once
// Generate returns an error -- never got its turn. Long enough for a reasoning
// model to finish, short enough that a dead network looks like offline mode.
var defaultProviderTimeout = 45 * time.Second

// WithHTTPClient injects a custom HTTP client (used by tests and future proxy
// setups). The default is a client bounded by defaultProviderTimeout.
func WithHTTPClient(client *http.Client) ProviderOption {
	return func(options *providerOptions) {
		if client != nil {
			options.httpClient = client
		}
	}
}

func resolveProviderOptions(options ...ProviderOption) providerOptions {
	resolved := providerOptions{httpClient: &http.Client{Timeout: defaultProviderTimeout}}
	for _, option := range options {
		if option != nil {
			option(&resolved)
		}
	}
	return resolved
}

func validateVendorConfig(vendor string, cfg VendorConfig) error {
	label := strings.TrimSpace(vendor)
	if label == "" {
		label = "provider"
	}
	if strings.TrimSpace(cfg.APIKey) == "" {
		return NewProviderError(ErrorConfigMissing, label+" API key is not configured")
	}
	if strings.TrimSpace(cfg.BaseURL) == "" {
		return NewProviderError(ErrorConfigMissing, label+" base URL is not configured")
	}
	parsed, err := url.Parse(strings.TrimSpace(cfg.BaseURL))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" || (parsed.Scheme != "https" && parsed.Scheme != "http") {
		return NewProviderError(ErrorPermanent, label+" base URL is invalid")
	}
	if strings.TrimSpace(cfg.Model) == "" {
		return NewProviderError(ErrorConfigMissing, label+" model is not configured")
	}
	return nil
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
