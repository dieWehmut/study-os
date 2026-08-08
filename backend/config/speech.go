package config

import "strings"

// SpeechConfig holds the globally configured OpenAI-compatible speech endpoint.
// A saved voice role may override the non-secret fields per request; the key
// always stays here so it is never written to the database or an API response.
type SpeechConfig struct {
	Provider string
	BaseURL  string
	APIKey   string
	Model    string
	Voice    string
	Format   string
}

// SpeechProviderSpec describes one preset in the 语音合成 settings picker.
//
// Every entry speaks the same protocol -- POST {BaseURL}/audio/speech -- so a
// preset only has to supply sensible defaults and, for Azure, the one auth style
// that is not a bearer token. Local engines carry Local so the UI can explain
// that an API key is optional.
type SpeechProviderSpec struct {
	ID           string `json:"id"`
	DisplayName  string `json:"display_name"`
	BaseURL      string `json:"base_url,omitempty"`
	Model        string `json:"model,omitempty"`
	Voice        string `json:"voice,omitempty"`
	AuthStyle    string `json:"auth_style,omitempty"`
	Local        bool   `json:"local,omitempty"`
	VoiceHint    string `json:"voice_hint,omitempty"`
	EndpointHint string `json:"endpoint_hint,omitempty"`
}

// AuthAPIKeyHeaderStyle mirrors audio.AuthAPIKeyHeader. It lives here as a bare
// string so the config package stays free of an import cycle with audio.
const AuthAPIKeyHeaderStyle = "api_key_header"

// speechProviderSpecs is the single source of truth for the speech presets, the
// same way vendorSpecs is for chat providers.
var speechProviderSpecs = []SpeechProviderSpec{
	{
		ID:          "openai",
		DisplayName: "OpenAI",
		BaseURL:     "https://api.openai.com/v1",
		Model:       "gpt-4o-mini-tts",
		Voice:       "alloy",
		VoiceHint:   "alloy、echo、fable、nova、onyx、shimmer",
	},
	{
		ID:          "openrouter",
		DisplayName: "OpenRouter",
		BaseURL:     "https://openrouter.ai/api/v1",
		Model:       "openai/gpt-4o-mini-tts",
		Voice:       "alloy",
		VoiceHint:   "跟随所选模型的发音人命名",
	},
	{
		ID:          "groq",
		DisplayName: "Groq",
		BaseURL:     "https://api.groq.com/openai/v1",
		Model:       "playai-tts",
		Voice:       "Arista-PlayAI",
		VoiceHint:   "如 Arista-PlayAI、Basil-PlayAI",
	},
	{
		ID:          "siliconflow",
		DisplayName: "SiliconFlow 硅基流动",
		BaseURL:     "https://api.siliconflow.cn/v1",
		Model:       "FunAudioLLM/CosyVoice2-0.5B",
		Voice:       "FunAudioLLM/CosyVoice2-0.5B:alex",
		VoiceHint:   "形如 模型名:发音人，区分大小写",
	},
	{
		ID:           "azure_openai",
		DisplayName:  "Azure OpenAI",
		AuthStyle:    AuthAPIKeyHeaderStyle,
		Model:        "tts-1",
		Voice:        "alloy",
		EndpointHint: "填写部署完整地址，可带 ?api-version=",
		VoiceHint:    "alloy、echo、fable、nova、onyx、shimmer",
	},
	{
		ID:           "local",
		DisplayName:  "本地服务",
		BaseURL:      "http://127.0.0.1:8100/v1",
		Local:        true,
		EndpointHint: "任何本地 OpenAI 兼容服务，如 IndexTTS2、vLLM、LM Studio",
		VoiceHint:    "由本地服务自行定义",
	},
	{
		ID:           "custom",
		DisplayName:  "自定义 (OpenAI 兼容)",
		EndpointHint: "填写以 /v1 结尾的 API 基地址",
	},
}

// SpeechProviders returns the preset list for the settings picker.
func SpeechProviders() []SpeechProviderSpec {
	specs := make([]SpeechProviderSpec, len(speechProviderSpecs))
	copy(specs, speechProviderSpecs)
	return specs
}

// LookupSpeechProvider resolves a preset id, tolerating the spellings a
// hand-edited env file is likely to contain.
func LookupSpeechProvider(id string) (SpeechProviderSpec, bool) {
	normalized := strings.ToLower(strings.TrimSpace(id))
	normalized = strings.ReplaceAll(normalized, "-", "_")
	switch normalized {
	case "azure", "aoai":
		normalized = "azure_openai"
	case "vllm", "lmstudio", "localhost":
		normalized = "local"
	case "openai_compatible":
		normalized = "custom"
	}
	for _, spec := range speechProviderSpecs {
		if spec.ID == normalized {
			return spec, true
		}
	}
	return SpeechProviderSpec{}, false
}

// SpeechStatus is the read-only 语音合成 view exposed to the settings UI. As with
// chat vendors the key itself is never included, only whether one is set.
type SpeechStatus struct {
	Provider      string               `json:"provider"`
	BaseURL       string               `json:"base_url,omitempty"`
	Model         string               `json:"model,omitempty"`
	Voice         string               `json:"voice,omitempty"`
	Format        string               `json:"format,omitempty"`
	KeyConfigured bool                 `json:"key_configured"`
	Configured    bool                 `json:"configured"`
	Providers     []SpeechProviderSpec `json:"providers"`
}

// Speech reports the resolved speech settings with preset defaults applied, so
// the UI and the runtime agree on what an unset field means.
func (c Config) Speech() SpeechConfig {
	resolved := c.SpeechSettings
	spec, ok := LookupSpeechProvider(resolved.Provider)
	if !ok {
		spec, _ = LookupSpeechProvider("custom")
	}
	if resolved.BaseURL == "" {
		resolved.BaseURL = spec.BaseURL
	}
	if resolved.Model == "" {
		resolved.Model = spec.Model
	}
	if resolved.Voice == "" {
		resolved.Voice = spec.Voice
	}
	if resolved.Format == "" {
		resolved.Format = "wav"
	}
	return resolved
}

// SpeechAuthStyle reports how the configured preset expects its credential.
func (c Config) SpeechAuthStyle() string {
	if spec, ok := LookupSpeechProvider(c.SpeechSettings.Provider); ok && spec.AuthStyle != "" {
		return spec.AuthStyle
	}
	return "bearer"
}

// SpeechStatus builds the settings payload. Configured reports whether synthesis
// can actually run: an endpoint is enough for a local server, while a hosted
// vendor also needs a key.
func (c Config) SpeechStatus() SpeechStatus {
	resolved := c.Speech()
	spec, ok := LookupSpeechProvider(resolved.Provider)
	configured := resolved.BaseURL != "" && (resolved.APIKey != "" || (ok && spec.Local))
	return SpeechStatus{
		Provider:      resolved.Provider,
		BaseURL:       resolved.BaseURL,
		Model:         resolved.Model,
		Voice:         resolved.Voice,
		Format:        resolved.Format,
		KeyConfigured: resolved.APIKey != "",
		Configured:    configured,
		Providers:     SpeechProviders(),
	}
}
