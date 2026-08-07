package config

import "strings"

// APIStyle names the wire protocol a vendor speaks. Every hosted vendor Study
// OS talks to is either OpenAI Chat Completions compatible or Anthropic
// Messages, so the provider layer only needs two HTTP implementations.
type APIStyle string

const (
	StyleMock      APIStyle = "mock"
	StyleOpenAI    APIStyle = "openai"
	StyleAnthropic APIStyle = "anthropic"
)

// VendorConfig holds one vendor's resolved settings. Secrets stay in memory
// only: this struct is never serialised into an API response or a log line.
type VendorConfig struct {
	APIKey         string
	BaseURL        string
	Model          string
	ReasoningModel string
}

// VendorSpec describes a vendor declaratively so that adding a provider is a
// data change instead of parallel edits across the config loader, the env
// allow-list, the provider factory, and the settings HTTP handler. Env keys
// are derived from EnvPrefix, which is what keeps those lists from drifting.
type VendorSpec struct {
	ID          string
	DisplayName string
	Style       APIStyle
	EnvPrefix   string
	// BaseURL, Model and ReasoningModel are defaults only. Every one is
	// overridable from the env file so a vendor renaming a model never
	// requires a code change.
	BaseURL        string
	Model          string
	ReasoningModel string
}

var vendorSpecs = []VendorSpec{
	{ID: "mock", DisplayName: "本地离线", Style: StyleMock},
	{
		ID: "deepseek", DisplayName: "DeepSeek", Style: StyleOpenAI, EnvPrefix: "DEEPSEEK",
		BaseURL: "https://api.deepseek.com/v1",
		Model:   "deepseek-v4-flash", ReasoningModel: "deepseek-v4-pro",
	},
	{
		// Anthropic keys are conventionally ANTHROPIC_API_KEY, so the prefix
		// deliberately differs from the vendor id shown in the UI.
		ID: "claude", DisplayName: "Claude（Anthropic）", Style: StyleAnthropic, EnvPrefix: "ANTHROPIC",
		BaseURL: "https://api.anthropic.com/v1",
		Model:   "claude-sonnet-4-6", ReasoningModel: "claude-opus-4-6",
	},
	{
		ID: "openai", DisplayName: "OpenAI", Style: StyleOpenAI, EnvPrefix: "OPENAI",
		BaseURL: "https://api.openai.com/v1",
		Model:   "gpt-4.1-mini", ReasoningModel: "gpt-4.1",
	},
	{
		ID: "qwen", DisplayName: "通义千问（百炼）", Style: StyleOpenAI, EnvPrefix: "QWEN",
		BaseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
		Model:   "qwen-plus", ReasoningModel: "qwen-max",
	},
	{
		ID: "glm", DisplayName: "智谱 GLM", Style: StyleOpenAI, EnvPrefix: "GLM",
		BaseURL: "https://open.bigmodel.cn/api/paas/v4",
		Model:   "glm-4-flash", ReasoningModel: "glm-4-plus",
	},
	{
		ID: "volcengine", DisplayName: "火山豆包", Style: StyleOpenAI, EnvPrefix: "VOLCENGINE",
		BaseURL: "https://ark.cn-beijing.volces.com/api/v3",
		Model:   "doubao-pro-32k", ReasoningModel: "doubao-pro-256k",
	},
}

// VendorSpecs returns the vendor registry in display order.
func VendorSpecs() []VendorSpec {
	specs := make([]VendorSpec, len(vendorSpecs))
	copy(specs, vendorSpecs)
	return specs
}

// LookupVendor resolves a vendor id case-insensitively.
func LookupVendor(id string) (VendorSpec, bool) {
	id = strings.ToLower(strings.TrimSpace(id))
	for _, spec := range vendorSpecs {
		if spec.ID == id {
			return spec, true
		}
	}
	return VendorSpec{}, false
}

// EnvKeys lists the env keys this vendor owns, keyed by settings field. The
// mock vendor owns none because it needs no credentials.
func (s VendorSpec) EnvKeys() map[string]string {
	if s.EnvPrefix == "" {
		return nil
	}
	return map[string]string{
		"api_key":         s.EnvPrefix + "_API_KEY",
		"base_url":        s.EnvPrefix + "_BASE_URL",
		"model":           s.EnvPrefix + "_MODEL",
		"reasoning_model": s.EnvPrefix + "_REASONING_MODEL",
	}
}

// NeedsKey reports whether the vendor requires an API key to work at all.
func (s VendorSpec) NeedsKey() bool {
	return s.Style != StyleMock
}

// Vendor returns the resolved settings for a vendor id, falling back to the
// registry defaults for anything the environment did not set.
func (c Config) Vendor(id string) VendorConfig {
	spec, ok := LookupVendor(id)
	if !ok {
		return VendorConfig{}
	}
	resolved := c.AI[spec.ID]
	if strings.TrimSpace(resolved.BaseURL) == "" {
		resolved.BaseURL = spec.BaseURL
	}
	if strings.TrimSpace(resolved.Model) == "" {
		resolved.Model = spec.Model
	}
	if strings.TrimSpace(resolved.ReasoningModel) == "" {
		resolved.ReasoningModel = spec.ReasoningModel
	}
	return resolved
}

// Vendors returns the read-only vendor registry view for the settings UI.
// API keys are never included, only whether one is configured.
func (c Config) Vendors() []VendorStatus {
	active := strings.ToLower(strings.TrimSpace(c.ActiveProvider))
	if active == "" {
		active = "mock"
	}
	statuses := make([]VendorStatus, 0, len(vendorSpecs))
	for _, spec := range vendorSpecs {
		status := VendorStatus{
			ID:          spec.ID,
			DisplayName: spec.DisplayName,
			Implemented: true,
			Active:      active == spec.ID,
		}
		if spec.NeedsKey() {
			resolved := c.Vendor(spec.ID)
			status.KeyConfigured = strings.TrimSpace(resolved.APIKey) != ""
			status.BaseURL = strings.TrimRight(resolved.BaseURL, "/")
			status.Models = []string{resolved.Model, resolved.ReasoningModel}
		}
		statuses = append(statuses, status)
	}
	return statuses
}
