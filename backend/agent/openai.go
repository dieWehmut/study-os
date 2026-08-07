package agent

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// OpenAIProvider calls any vendor that exposes an OpenAI-compatible Chat
// Completions endpoint: DeepSeek, OpenAI, Qwen, GLM and Volcengine all do.
// The vendor name is carried so errors and Name() identify the real upstream.
type OpenAIProvider struct {
	name           string
	apiKey         string
	baseURL        string
	model          string
	reasoningModel string
	httpClient     *http.Client
}

var _ Provider = (*OpenAIProvider)(nil)

func NewOpenAIProvider(name string, cfg VendorConfig, options ...ProviderOption) (*OpenAIProvider, error) {
	name = strings.ToLower(strings.TrimSpace(name))
	if name == "" {
		name = "openai"
	}
	if err := validateVendorConfig(name, cfg); err != nil {
		return nil, err
	}
	provider := &OpenAIProvider{
		name:           name,
		apiKey:         strings.TrimSpace(cfg.APIKey),
		baseURL:        strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/"),
		model:          strings.TrimSpace(cfg.Model),
		reasoningModel: strings.TrimSpace(cfg.ReasoningModel),
		httpClient:     resolveProviderOptions(options...).httpClient,
	}
	if provider.reasoningModel == "" {
		provider.reasoningModel = provider.model
	}
	return provider, nil
}

func (p *OpenAIProvider) Name() string {
	return p.name
}

func (p *OpenAIProvider) Generate(ctx context.Context, request Request) (Response, error) {
	if err := ctxErr(ctx); err != nil {
		return Response{}, err
	}
	if err := request.Validate(); err != nil {
		return Response{}, err
	}

	thinking, effort, err := normalizedOptions(request.Options)
	if err != nil {
		return Response{}, err
	}
	model := p.model
	if strings.TrimSpace(request.Options.Model) != "" {
		model = strings.TrimSpace(request.Options.Model)
	}
	body := map[string]any{
		"model": model,
		"messages": []map[string]string{
			{"role": "system", "content": systemPromptFor(request.Kind)},
			{"role": "user", "content": userPromptFor(request)},
		},
		"response_format": map[string]string{"type": "json_object"},
		"stream":          false,
	}
	// `thinking` and `reasoning_effort` are DeepSeek extensions. OpenAI-compatible
	// endpoints reject unknown parameters with 400, so only DeepSeek gets them and
	// every other vendor receives the plain, maximally portable body.
	if p.name == "deepseek" {
		body["thinking"] = map[string]string{"type": thinking}
		if thinking == "disabled" {
			body["temperature"] = 0.2
		} else if effort != "" {
			body["reasoning_effort"] = effort
		}
	} else if thinking == "disabled" {
		body["temperature"] = 0.2
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return Response{}, NewProviderError(ErrorPermanent, "encode "+p.name+" request failed")
	}

	endpoint := p.baseURL + "/chat/completions"
	httpRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return Response{}, NewProviderError(ErrorPermanent, "build "+p.name+" request failed")
	}
	httpRequest.Header.Set("Authorization", "Bearer "+p.apiKey)
	httpRequest.Header.Set("Content-Type", "application/json")

	response, err := p.httpClient.Do(httpRequest)
	if err != nil {
		return Response{}, &ProviderError{
			Class:   ErrorTemporary,
			Message: p.name + " request failed",
			Cause:   err,
		}
	}
	defer response.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(response.Body, 4<<20))
	if err != nil {
		return Response{}, NewProviderError(ErrorTemporary, "read "+p.name+" response failed")
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return Response{}, classifyProviderHTTP(p.name, response.StatusCode, response.Header.Get("Retry-After"), responseBody)
	}

	var envelope struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(responseBody, &envelope); err != nil {
		return Response{}, NewProviderError(ErrorPermanent, "decode "+p.name+" response failed")
	}
	content := ""
	if len(envelope.Choices) > 0 {
		content = strings.TrimSpace(envelope.Choices[0].Message.Content)
	}
	if content == "" {
		return Response{}, NewProviderError(ErrorPermanent, p.name+" returned an empty completion")
	}
	output, err := decodeProviderOutput(request.Kind, content)
	if err != nil {
		return Response{}, NewProviderError(ErrorPermanent, err.Error())
	}
	return output, nil
}

func normalizedOptions(options Options) (string, string, error) {
	thinking := "disabled"
	switch strings.ToLower(strings.TrimSpace(options.Thinking)) {
	case "":
	case "enabled":
		thinking = "enabled"
	case "disabled":
		thinking = "disabled"
	default:
		return "", "", NewProviderError(ErrorPermanent, "thinking must be enabled or disabled")
	}
	effort := strings.ToLower(strings.TrimSpace(options.ReasoningEffort))
	switch effort {
	case "", "low", "high", "max":
	default:
		return "", "", NewProviderError(ErrorPermanent, "reasoning_effort must be low, high, or max")
	}
	return thinking, effort, nil
}

// classifyProviderHTTP maps an upstream status onto the queue's retry classes.
// The mapping is deliberately status-based rather than vendor-based: both wire
// protocols use the same HTTP semantics for auth, rate limits and outages.
func classifyProviderHTTP(vendor string, status int, retryAfter string, body []byte) error {
	message := providerErrorMessage(body)
	switch {
	case status == http.StatusTooManyRequests:
		var delay time.Duration
		if seconds, err := strconv.Atoi(strings.TrimSpace(retryAfter)); err == nil && seconds > 0 {
			delay = time.Duration(seconds) * time.Second
		}
		if message == "" {
			message = vendor + " rate limit exceeded"
		}
		return NewRateLimitError(message, delay)
	case status == http.StatusBadRequest || status == http.StatusUnauthorized ||
		status == http.StatusForbidden || status == http.StatusNotFound:
		if message == "" {
			message = vendor + " rejected the request"
		}
		return NewProviderError(ErrorPermanent, message)
	case status >= 500:
		if message == "" {
			message = vendor + " upstream unavailable"
		}
		return NewProviderError(ErrorTemporary, message)
	default:
		return NewProviderError(ErrorTemporary, vendor+" request failed")
	}
}

