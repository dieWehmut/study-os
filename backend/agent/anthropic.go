package agent

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
)

// anthropicVersion is the dated API contract, not a model version. It is
// required on every request and is independent of which model is selected.
const anthropicVersion = "2023-06-01"

// anthropicMaxTokens must be sent explicitly: unlike the OpenAI-compatible
// endpoint, the Messages API has no default. The value is generous enough for
// the longest Study OS output (a word wiki's detailed Markdown).
const anthropicMaxTokens = 8192

// AnthropicProvider calls the Anthropic Messages API. It is a separate
// provider rather than a flag on OpenAIProvider because the wire protocol
// differs in three ways that cannot be papered over: authentication uses
// x-api-key instead of a bearer token, the system prompt is a top-level field
// instead of a message, and the response is a content block array.
type AnthropicProvider struct {
	name           string
	apiKey         string
	baseURL        string
	model          string
	reasoningModel string
	httpClient     *http.Client
}

var _ Provider = (*AnthropicProvider)(nil)

func NewAnthropicProvider(name string, cfg VendorConfig, options ...ProviderOption) (*AnthropicProvider, error) {
	name = strings.ToLower(strings.TrimSpace(name))
	if name == "" {
		name = "claude"
	}
	if err := validateVendorConfig(name, cfg); err != nil {
		return nil, err
	}
	provider := &AnthropicProvider{
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

func (p *AnthropicProvider) Name() string {
	return p.name
}

func (p *AnthropicProvider) Generate(ctx context.Context, request Request) (Response, error) {
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
		"model":      model,
		"max_tokens": anthropicMaxTokens,
		"system":     systemPromptFor(request.Kind),
		"messages": []map[string]string{
			{"role": "user", "content": userPromptFor(request)},
		},
	}
	// Adaptive thinking lets the model decide its own depth; a fixed token
	// budget is deprecated on current models. temperature and thinking are
	// mutually exclusive, so only the non-thinking path pins temperature.
	if thinking == "enabled" {
		body["thinking"] = map[string]string{"type": "adaptive"}
		if effort != "" {
			body["output_config"] = map[string]string{"effort": effort}
		}
	} else {
		body["temperature"] = 0.2
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return Response{}, NewProviderError(ErrorPermanent, "encode "+p.name+" request failed")
	}

	endpoint := p.baseURL + "/messages"
	httpRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return Response{}, NewProviderError(ErrorPermanent, "build "+p.name+" request failed")
	}
	httpRequest.Header.Set("x-api-key", p.apiKey)
	httpRequest.Header.Set("anthropic-version", anthropicVersion)
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
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
	}
	if err := json.Unmarshal(responseBody, &envelope); err != nil {
		return Response{}, NewProviderError(ErrorPermanent, "decode "+p.name+" response failed")
	}
	// Thinking blocks are returned alongside text blocks, so the answer is the
	// concatenation of the text blocks rather than simply the first block.
	var builder strings.Builder
	for _, block := range envelope.Content {
		if block.Type == "text" {
			builder.WriteString(block.Text)
		}
	}
	content := stripJSONFence(builder.String())
	if content == "" {
		return Response{}, NewProviderError(ErrorPermanent, p.name+" returned an empty completion")
	}
	output, err := decodeProviderOutput(request.Kind, content)
	if err != nil {
		return Response{}, NewProviderError(ErrorPermanent, err.Error())
	}
	return output, nil
}

// stripJSONFence removes a Markdown code fence around a JSON object. The
// Messages API has no response_format switch, so the JSON-only instruction in
// the system prompt is advisory and the model may still wrap its answer.
func stripJSONFence(content string) string {
	content = strings.TrimSpace(content)
	if !strings.HasPrefix(content, "```") {
		return content
	}
	content = strings.TrimPrefix(content, "```")
	if index := strings.IndexByte(content, '\n'); index >= 0 {
		// Drop the language tag ("json") that follows the opening fence.
		if language := strings.TrimSpace(content[:index]); !strings.HasPrefix(language, "{") {
			content = content[index+1:]
		}
	}
	if index := strings.LastIndex(content, "```"); index >= 0 {
		content = content[:index]
	}
	return strings.TrimSpace(content)
}
