package agent_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"study-os/backend/agent"
)

func TestNewOpenAIProviderValidatesConfiguration(t *testing.T) {
	tests := []struct {
		name    string
		config  agent.VendorConfig
		wantErr agent.ErrorClass
	}{
		{name: "missing key", config: agent.VendorConfig{BaseURL: "https://api.deepseek.com/v1", Model: "deepseek-v4-flash"}, wantErr: agent.ErrorConfigMissing},
		{name: "missing base url", config: agent.VendorConfig{APIKey: "sk-test", Model: "deepseek-v4-flash"}, wantErr: agent.ErrorConfigMissing},
		{name: "bad base url", config: agent.VendorConfig{APIKey: "sk-test", BaseURL: "://bad", Model: "deepseek-v4-flash"}, wantErr: agent.ErrorPermanent},
		{name: "missing model", config: agent.VendorConfig{APIKey: "sk-test", BaseURL: "https://api.deepseek.com/v1"}, wantErr: agent.ErrorConfigMissing},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := agent.NewOpenAIProvider("deepseek", test.config)
			if err == nil {
				t.Fatal("expected a configuration error")
			}
			if class := agent.ErrorClassOf(err); class != test.wantErr {
				t.Fatalf("error class = %q, want %q", class, test.wantErr)
			}
			if strings.Contains(err.Error(), "sk-test") {
				t.Fatalf("configuration error leaked a secret: %v", err)
			}
		})
	}
}

func TestOpenAIProviderCallsChatCompletionsAndDecodes(t *testing.T) {
	var captured map[string]any
	var authorization string
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/v1/chat/completions" {
			t.Errorf("path = %q", request.URL.Path)
		}
		authorization = request.Header.Get("Authorization")
		_ = json.NewDecoder(request.Body).Decode(&captured)
		response.Header().Set("Content-Type", "application/json")
		_, _ = response.Write([]byte(`{
			"choices": [{
				"message": {
					"content": "{\"sentence\":\"I abandon my old plan.\",\"translation\":\"我放弃旧计划。\",\"blanked\":\"I _____ my old plan.\"}"
				}
			}]
		}`))
	}))
	defer server.Close()

	provider, err := agent.NewOpenAIProvider("deepseek", agent.VendorConfig{
		APIKey:  "sk-test",
		BaseURL: server.URL + "/v1",
		Model:   "deepseek-v4-flash",
	}, agent.WithHTTPClient(server.Client()))
	if err != nil {
		t.Fatalf("create provider: %v", err)
	}
	output, err := provider.Generate(context.Background(), agent.Request{
		Kind: agent.KindMakeSentence,
		Sentence: &agent.SentenceInput{
			Term:       "abandon",
			Definition: "to leave behind",
		},
	})
	if err != nil {
		t.Fatalf("generate sentence: %v", err)
	}
	if output.Sentence == nil || output.Sentence.Sentence != "I abandon my old plan." {
		t.Fatalf("sentence output = %#v", output.Sentence)
	}
	if output.Sentence.Blanked != "I _____ my old plan." {
		t.Fatalf("blanked = %q", output.Sentence.Blanked)
	}
	if authorization != "Bearer sk-test" {
		t.Fatalf("authorization = %q", authorization)
	}
	if captured["model"] != "deepseek-v4-flash" {
		t.Fatalf("model = %#v", captured["model"])
	}
	format, _ := captured["response_format"].(map[string]any)
	if format["type"] != "json_object" {
		t.Fatalf("response_format = %#v", captured["response_format"])
	}
	thinking, _ := captured["thinking"].(map[string]any)
	if thinking["type"] != "disabled" {
		t.Fatalf("thinking = %#v", captured["thinking"])
	}
	if captured["temperature"] != float64(0.2) {
		t.Fatalf("temperature = %#v", captured["temperature"])
	}
	if _, exists := captured["reasoning_effort"]; exists {
		t.Fatalf("reasoning_effort must be omitted when thinking is disabled")
	}
}

func TestOpenAIProviderUsesOptionsAndReasoningModel(t *testing.T) {
	var captured map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		_ = json.NewDecoder(request.Body).Decode(&captured)
		_, _ = response.Write([]byte(`{"choices":[{"message":{"content":"{\"sentence\":\"X\",\"blanked\":\"Y\"}"}}]}`))
	}))
	defer server.Close()

	provider, err := agent.NewOpenAIProvider("deepseek", agent.VendorConfig{
		APIKey:         "sk-test",
		BaseURL:        server.URL,
		Model:          "deepseek-v4-flash",
		ReasoningModel: "deepseek-v4-pro",
	}, agent.WithHTTPClient(server.Client()))
	if err != nil {
		t.Fatalf("create provider: %v", err)
	}
	_, err = provider.Generate(context.Background(), agent.Request{
		Kind: agent.KindMakeSentence,
		Options: agent.Options{
			Model:           "deepseek-v4-pro",
			Thinking:        "enabled",
			ReasoningEffort: "max",
		},
		Sentence: &agent.SentenceInput{Term: "abandon"},
	})
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	if captured["model"] != "deepseek-v4-pro" {
		t.Fatalf("model = %#v", captured["model"])
	}
	thinking, _ := captured["thinking"].(map[string]any)
	if thinking["type"] != "enabled" {
		t.Fatalf("thinking = %#v", captured["thinking"])
	}
	if captured["reasoning_effort"] != "max" {
		t.Fatalf("reasoning_effort = %#v", captured["reasoning_effort"])
	}
	if _, exists := captured["temperature"]; exists {
		t.Fatalf("temperature must be omitted in thinking mode")
	}
}

// `thinking` and `reasoning_effort` are DeepSeek extensions. A strict
// OpenAI-compatible endpoint answers 400 for unknown body parameters, so every
// other vendor must receive the portable body even when the caller asks for
// thinking. Without this guard the shared provider silently breaks Qwen, GLM,
// OpenAI and Volcengine on every request.
func TestOpenAIProviderOmitsDeepSeekExtensionsForOtherVendors(t *testing.T) {
	for _, vendor := range []string{"openai", "qwen", "glm", "volcengine"} {
		t.Run(vendor, func(t *testing.T) {
			var captured map[string]any
			server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
				_ = json.NewDecoder(request.Body).Decode(&captured)
				_, _ = response.Write([]byte(`{"choices":[{"message":{"content":"{\"sentence\":\"X\",\"blanked\":\"Y\"}"}}]}`))
			}))
			defer server.Close()

			provider, err := agent.NewOpenAIProvider(vendor, agent.VendorConfig{
				APIKey:  "sk-test",
				BaseURL: server.URL,
				Model:   "some-model",
			}, agent.WithHTTPClient(server.Client()))
			if err != nil {
				t.Fatalf("create provider: %v", err)
			}
			_, err = provider.Generate(context.Background(), agent.Request{
				Kind: agent.KindMakeSentence,
				Options: agent.Options{
					Thinking:        "enabled",
					ReasoningEffort: "max",
				},
				Sentence: &agent.SentenceInput{Term: "abandon"},
			})
			if err != nil {
				t.Fatalf("generate: %v", err)
			}
			if _, exists := captured["thinking"]; exists {
				t.Fatalf("%s must not receive the deepseek thinking parameter", vendor)
			}
			if _, exists := captured["reasoning_effort"]; exists {
				t.Fatalf("%s must not receive the deepseek reasoning_effort parameter", vendor)
			}
		})
	}
}

func TestOpenAIProviderClassifiesErrors(t *testing.T) {
	tests := []struct {
		name       string
		status     int
		retryAfter string
		wantClass  agent.ErrorClass
	}{
		{name: "rate limited", status: http.StatusTooManyRequests, retryAfter: "5", wantClass: agent.ErrorRateLimited},
		{name: "auth failure", status: http.StatusUnauthorized, wantClass: agent.ErrorPermanent},
		{name: "bad request", status: http.StatusBadRequest, wantClass: agent.ErrorPermanent},
		{name: "upstream failure", status: http.StatusBadGateway, wantClass: agent.ErrorTemporary},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
				if test.retryAfter != "" {
					response.Header().Set("Retry-After", test.retryAfter)
				}
				response.WriteHeader(test.status)
				_, _ = response.Write([]byte(`{"error":{"message":"upstream says no"}}`))
			}))
			defer server.Close()
			provider, err := agent.NewOpenAIProvider("deepseek", agent.VendorConfig{
				APIKey:  "sk-test",
				BaseURL: server.URL,
				Model:   "deepseek-v4-flash",
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
		})
	}
}

func TestOpenAIProviderRejectsMalformedModelJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		_, _ = response.Write([]byte(`{"choices":[{"message":{"content":"not json at all"}}]}`))
	}))
	defer server.Close()
	provider, err := agent.NewOpenAIProvider("deepseek", agent.VendorConfig{
		APIKey:  "sk-test",
		BaseURL: server.URL,
		Model:   "deepseek-v4-flash",
	}, agent.WithHTTPClient(server.Client()))
	if err != nil {
		t.Fatalf("create provider: %v", err)
	}
	_, err = provider.Generate(context.Background(), agent.Request{
		Kind: agent.KindMakeSentence,
		Sentence: &agent.SentenceInput{
			Term:       "abandon",
			Definition: "to leave behind",
		},
	})
	if err == nil {
		t.Fatal("expected a permanent parse error")
	}
	var providerErr *agent.ProviderError
	if !errors.As(err, &providerErr) || providerErr.Class != agent.ErrorPermanent {
		t.Fatalf("error = %v (class %q)", err, agent.ErrorClassOf(err))
	}
	if strings.Contains(err.Error(), "sk-test") {
		t.Fatalf("error leaked the API key: %v", err)
	}
}
