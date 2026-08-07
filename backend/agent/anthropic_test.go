package agent_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"study-os/backend/agent"
)

func TestAnthropicProviderSendsMessagesProtocol(t *testing.T) {
	var captured map[string]any
	var headers http.Header
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/v1/messages" {
			t.Errorf("path = %q", request.URL.Path)
		}
		headers = request.Header.Clone()
		_ = json.NewDecoder(request.Body).Decode(&captured)
		response.Header().Set("Content-Type", "application/json")
		_, _ = response.Write([]byte(`{"content":[{"type":"text","text":"{\"sentence\":\"I abandon my old plan.\",\"blanked\":\"I _____ my old plan.\"}"}]}`))
	}))
	defer server.Close()

	provider, err := agent.NewAnthropicProvider("claude", agent.VendorConfig{
		APIKey:  "sk-ant-test",
		BaseURL: server.URL + "/v1",
		Model:   "claude-sonnet-4-6",
	}, agent.WithHTTPClient(server.Client()))
	if err != nil {
		t.Fatalf("create provider: %v", err)
	}
	output, err := provider.Generate(context.Background(), agent.Request{
		Kind:     agent.KindMakeSentence,
		Sentence: &agent.SentenceInput{Term: "abandon", Definition: "to leave behind"},
	})
	if err != nil {
		t.Fatalf("generate sentence: %v", err)
	}
	if output.Sentence == nil || output.Sentence.Sentence != "I abandon my old plan." {
		t.Fatalf("sentence output = %#v", output.Sentence)
	}

	// The three protocol differences from the OpenAI-compatible endpoint.
	if got := headers.Get("x-api-key"); got != "sk-ant-test" {
		t.Fatalf("x-api-key = %q", got)
	}
	if got := headers.Get("anthropic-version"); got == "" {
		t.Fatal("anthropic-version header is required on every request")
	}
	if headers.Get("Authorization") != "" {
		t.Fatal("Anthropic authenticates with x-api-key, not a bearer token")
	}
	if system, _ := captured["system"].(string); !strings.Contains(system, "JSON") {
		t.Fatalf("system prompt must be a top-level string carrying the JSON instruction: %#v", captured["system"])
	}
	if _, exists := captured["max_tokens"]; !exists {
		t.Fatal("max_tokens has no default on the Messages API and must be sent")
	}
	messages, _ := captured["messages"].([]any)
	if len(messages) != 1 {
		t.Fatalf("messages = %#v, want only the user turn", captured["messages"])
	}
}

// The Messages API has no response_format switch, so the JSON-only rule is a
// system prompt instruction the model may still wrap in a Markdown fence.
// Unwrapping keeps a stylistic choice from becoming a hard failure.
func TestAnthropicProviderUnwrapsFencedJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		_, _ = response.Write([]byte(`{"content":[
			{"type":"thinking","thinking":"the user wants a sentence"},
			{"type":"text","text":"` + "```json\\n{\\\"sentence\\\":\\\"X\\\",\\\"blanked\\\":\\\"Y\\\"}\\n```" + `"}
		]}`))
	}))
	defer server.Close()

	provider, err := agent.NewAnthropicProvider("claude", agent.VendorConfig{
		APIKey:  "sk-ant-test",
		BaseURL: server.URL,
		Model:   "claude-sonnet-4-6",
	}, agent.WithHTTPClient(server.Client()))
	if err != nil {
		t.Fatalf("create provider: %v", err)
	}
	output, err := provider.Generate(context.Background(), agent.Request{
		Kind:     agent.KindMakeSentence,
		Sentence: &agent.SentenceInput{Term: "abandon"},
	})
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	if output.Sentence == nil || output.Sentence.Sentence != "X" {
		t.Fatalf("sentence output = %#v", output.Sentence)
	}
}

func TestAnthropicProviderUsesAdaptiveThinking(t *testing.T) {
	var captured map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		_ = json.NewDecoder(request.Body).Decode(&captured)
		_, _ = response.Write([]byte(`{"content":[{"type":"text","text":"{\"sentence\":\"X\",\"blanked\":\"Y\"}"}]}`))
	}))
	defer server.Close()

	provider, err := agent.NewAnthropicProvider("claude", agent.VendorConfig{
		APIKey:  "sk-ant-test",
		BaseURL: server.URL,
		Model:   "claude-sonnet-4-6",
	}, agent.WithHTTPClient(server.Client()))
	if err != nil {
		t.Fatalf("create provider: %v", err)
	}
	_, err = provider.Generate(context.Background(), agent.Request{
		Kind:     agent.KindMakeSentence,
		Options:  agent.Options{Model: "claude-opus-4-6", Thinking: "enabled", ReasoningEffort: "high"},
		Sentence: &agent.SentenceInput{Term: "abandon"},
	})
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	if captured["model"] != "claude-opus-4-6" {
		t.Fatalf("model = %#v", captured["model"])
	}
	// A fixed token budget is deprecated on current models; adaptive thinking
	// replaces it and lets the model choose its own depth.
	thinking, _ := captured["thinking"].(map[string]any)
	if thinking["type"] != "adaptive" {
		t.Fatalf("thinking = %#v", captured["thinking"])
	}
	if _, exists := thinking["budget_tokens"]; exists {
		t.Fatal("budget_tokens is deprecated and must not be sent")
	}
	// temperature and thinking are mutually exclusive on the Messages API.
	if _, exists := captured["temperature"]; exists {
		t.Fatalf("temperature must be omitted in thinking mode")
	}
	outputConfig, _ := captured["output_config"].(map[string]any)
	if outputConfig["effort"] != "high" {
		t.Fatalf("output_config = %#v", captured["output_config"])
	}
}

func TestAnthropicProviderClassifiesErrorsAndHidesSecrets(t *testing.T) {
	tests := []struct {
		name       string
		status     int
		retryAfter string
		wantClass  agent.ErrorClass
	}{
		{name: "rate limited", status: http.StatusTooManyRequests, retryAfter: "5", wantClass: agent.ErrorRateLimited},
		{name: "auth failure", status: http.StatusUnauthorized, wantClass: agent.ErrorPermanent},
		{name: "overloaded", status: 529, wantClass: agent.ErrorTemporary},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
				if test.retryAfter != "" {
					response.Header().Set("Retry-After", test.retryAfter)
				}
				response.WriteHeader(test.status)
				_, _ = response.Write([]byte(`{"type":"error","error":{"type":"api_error","message":"upstream says no"}}`))
			}))
			defer server.Close()

			provider, err := agent.NewAnthropicProvider("claude", agent.VendorConfig{
				APIKey:  "sk-ant-test",
				BaseURL: server.URL,
				Model:   "claude-sonnet-4-6",
			}, agent.WithHTTPClient(server.Client()))
			if err != nil {
				t.Fatalf("create provider: %v", err)
			}
			_, err = provider.Generate(context.Background(), agent.Request{
				Kind:    agent.KindSummary,
				Summary: &agent.SummaryInput{Text: "hello"},
			})
			if err == nil {
				t.Fatal("expected an error")
			}
			if class := agent.ErrorClassOf(err); class != test.wantClass {
				t.Fatalf("error class = %q, want %q", class, test.wantClass)
			}
			if strings.Contains(err.Error(), "sk-ant-test") {
				t.Fatalf("error leaked the API key: %v", err)
			}
		})
	}
}

func TestNewAnthropicProviderValidatesConfiguration(t *testing.T) {
	tests := []struct {
		name    string
		config  agent.VendorConfig
		wantErr agent.ErrorClass
	}{
		{name: "missing key", config: agent.VendorConfig{BaseURL: "https://api.anthropic.com/v1", Model: "claude-sonnet-4-6"}, wantErr: agent.ErrorConfigMissing},
		{name: "missing base url", config: agent.VendorConfig{APIKey: "sk-ant-test", Model: "claude-sonnet-4-6"}, wantErr: agent.ErrorConfigMissing},
		{name: "bad base url", config: agent.VendorConfig{APIKey: "sk-ant-test", BaseURL: "://bad", Model: "claude-sonnet-4-6"}, wantErr: agent.ErrorPermanent},
		{name: "missing model", config: agent.VendorConfig{APIKey: "sk-ant-test", BaseURL: "https://api.anthropic.com/v1"}, wantErr: agent.ErrorConfigMissing},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := agent.NewAnthropicProvider("claude", test.config)
			if err == nil {
				t.Fatal("expected a configuration error")
			}
			if class := agent.ErrorClassOf(err); class != test.wantErr {
				t.Fatalf("error class = %q, want %q", class, test.wantErr)
			}
			if strings.Contains(err.Error(), "sk-ant-test") {
				t.Fatalf("configuration error leaked a secret: %v", err)
			}
		})
	}
}
