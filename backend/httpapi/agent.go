package httpapi

import (
	"context"
	"net/http"
	"strings"
	"time"

	"study-os/backend/agent"
	"study-os/backend/app"
	"study-os/backend/config"
)

func providerFor(application *app.App) (agent.Provider, error) {
	if application == nil {
		return nil, agent.NewProviderError(agent.ErrorConfigMissing, "application unavailable")
	}
	return providerForVendor(application.Config, application.Config.ActiveProvider)
}

// providerForVendor builds a provider for one vendor id. Resolving the wire
// protocol and settings through the registry is what lets a newly registered
// vendor work here without any change to this file.
func providerForVendor(cfg config.Config, vendorID string) (agent.Provider, error) {
	active := strings.ToLower(strings.TrimSpace(vendorID))
	if active == "" {
		active = "mock"
	}
	spec, ok := config.LookupVendor(active)
	if !ok {
		return nil, agent.NewProviderError(agent.ErrorConfigMissing, "configured AI provider is unsupported")
	}
	resolved := cfg.Vendor(spec.ID)
	return agent.NewProvider(agent.ProviderConfig{
		Active: spec.ID,
		Style:  string(spec.Style),
		Vendor: agent.VendorConfig{
			APIKey:         resolved.APIKey,
			BaseURL:        resolved.BaseURL,
			Model:          resolved.Model,
			ReasoningModel: resolved.ReasoningModel,
		},
	})
}

func handleAgentStatus(response http.ResponseWriter, request *http.Request, application *app.App) {
	_, err := providerFor(application)
	configured := err == nil
	providerName := "mock"
	if application != nil {
		providerName = strings.ToLower(strings.TrimSpace(application.Config.ActiveProvider))
		if providerName == "" {
			providerName = "mock"
		}
	}
	payload := map[string]any{
		"provider":   providerName,
		"configured": configured,
		"available":  configured,
		"offline":    providerName == "mock",
	}
	if err != nil {
		payload["error_class"] = agent.ErrorClassOf(err)
	}
	writeJSON(response, http.StatusOK, payload)
}

func handleAgentVendors(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	active := strings.ToLower(strings.TrimSpace(application.Config.ActiveProvider))
	if active == "" {
		active = "mock"
	}
	writeJSON(response, http.StatusOK, map[string]any{
		"active_provider": active,
		"items":           application.Config.Vendors(),
	})
}

func handleAgentActive(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	if strings.TrimSpace(application.Config.EnvFilePath) == "" {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "env file path is unavailable in this runtime"})
		return
	}
	var input struct {
		Provider string `json:"provider"`
	}
	request.Body = http.MaxBytesReader(response, request.Body, maxImportJSONBytes)
	if err := decodeRequest(request, &input); err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if err := config.SetActiveProvider(application.Config.EnvFilePath, input.Provider); err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	application.Config.ActiveProvider = strings.ToLower(strings.TrimSpace(input.Provider))
	writeJSON(response, http.StatusOK, map[string]any{"active_provider": application.Config.ActiveProvider})
}

func handleAgentConfig(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	if strings.TrimSpace(application.Config.EnvFilePath) == "" {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "env file path is unavailable in this runtime"})
		return
	}
	var input struct {
		Provider       string  `json:"provider"`
		APIKey         *string `json:"api_key"`
		BaseURL        *string `json:"base_url"`
		Model          *string `json:"model"`
		ReasoningModel *string `json:"reasoning_model"`
		Voice          *string `json:"voice"`
	}
	request.Body = http.MaxBytesReader(response, request.Body, maxImportJSONBytes)
	if err := decodeRequest(request, &input); err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	provider := strings.ToLower(strings.TrimSpace(input.Provider))
	if provider == "" {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "provider is required"})
		return
	}

	// DashScope is the TTS vendor rather than a chat vendor, so it is not in the
	// AI registry and keeps its own branch. Every chat vendor derives its env
	// keys from the registry, so no new vendor needs a case here.
	updates := make(map[string]string)
	spec, isVendor := config.LookupVendor(provider)
	switch {
	case isVendor && spec.NeedsKey():
		keys := spec.EnvKeys()
		if input.APIKey != nil {
			updates[keys["api_key"]] = strings.TrimSpace(*input.APIKey)
		}
		if input.BaseURL != nil {
			updates[keys["base_url"]] = strings.TrimSpace(*input.BaseURL)
		}
		if input.Model != nil {
			updates[keys["model"]] = strings.TrimSpace(*input.Model)
		}
		if input.ReasoningModel != nil {
			updates[keys["reasoning_model"]] = strings.TrimSpace(*input.ReasoningModel)
		}
	case provider == "dashscope":
		if input.APIKey != nil {
			updates["DASHSCOPE_API_KEY"] = strings.TrimSpace(*input.APIKey)
		}
		if input.Voice != nil {
			updates["DASHSCOPE_TTS_VOICE"] = strings.TrimSpace(*input.Voice)
		}
	default:
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "unsupported provider for config updates"})
		return
	}
	if len(updates) == 0 {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "no config fields provided"})
		return
	}
	if err := config.UpdateEnvFile(application.Config.EnvFilePath, updates); err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	// Apply the same values to the in-memory config so the change takes effect
	// without a restart. The API key itself is never echoed back.
	payload := map[string]any{"provider": provider}
	if isVendor && spec.NeedsKey() {
		keys := spec.EnvKeys()
		if application.Config.AI == nil {
			application.Config.AI = make(map[string]config.VendorConfig)
		}
		vendor := application.Config.AI[spec.ID]
		if value, ok := updates[keys["api_key"]]; ok {
			vendor.APIKey = value
		}
		if value, ok := updates[keys["base_url"]]; ok {
			vendor.BaseURL = value
		}
		if value, ok := updates[keys["model"]]; ok {
			vendor.Model = value
		}
		if value, ok := updates[keys["reasoning_model"]]; ok {
			vendor.ReasoningModel = value
		}
		application.Config.AI[spec.ID] = vendor

		resolved := application.Config.Vendor(spec.ID)
		payload["key_configured"] = resolved.APIKey != ""
		payload["base_url"] = resolved.BaseURL
		payload["model"] = resolved.Model
		payload["reasoning_model"] = resolved.ReasoningModel
	}
	if value, ok := updates["DASHSCOPE_API_KEY"]; ok {
		application.Config.DashScopeAPIKey = value
	}
	if value, ok := updates["DASHSCOPE_TTS_VOICE"]; ok {
		application.Config.DashScopeVoice = value
	}
	if provider == "dashscope" {
		payload["key_configured"] = application.Config.DashScopeAPIKey != ""
		payload["voice"] = application.Config.DashScopeVoice
	}
	writeJSON(response, http.StatusOK, payload)
}

func handleAgentTest(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	var input struct {
		Provider string `json:"provider"`
	}
	request.Body = http.MaxBytesReader(response, request.Body, maxImportJSONBytes)
	if err := decodeRequest(request, &input); err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	providerName := strings.ToLower(strings.TrimSpace(input.Provider))
	if providerName == "" {
		providerName = strings.ToLower(strings.TrimSpace(application.Config.ActiveProvider))
	}
	if providerName == "mock" {
		writeJSON(response, http.StatusOK, map[string]any{"ok": true, "provider": "mock", "latency_ms": 0})
		return
	}
	provider, err := providerForVendor(application.Config, providerName)
	if err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]any{
			"error":       err.Error(),
			"error_class": agent.ErrorClassOf(err),
		})
		return
	}
	ctx, cancel := context.WithTimeout(request.Context(), 15*time.Second)
	defer cancel()
	started := time.Now()
	_, err = provider.Generate(ctx, agent.Request{
		Kind:    agent.KindSummary,
		Summary: &agent.SummaryInput{Title: "ping", Text: "ping", MaxKeyPoints: 1},
	})
	if err != nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]any{
			"error":       err.Error(),
			"error_class": agent.ErrorClassOf(err),
		})
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{
		"ok":         true,
		"provider":   provider.Name(),
		"latency_ms": time.Since(started).Milliseconds(),
	})
}

func handleAgentGenerate(response http.ResponseWriter, request *http.Request, application *app.App) {
	request.Body = http.MaxBytesReader(response, request.Body, maxImportJSONBytes)
	var input agent.Request
	if err := decodeRequest(request, &input); err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if err := input.Validate(); err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	provider, err := providerFor(application)
	if err != nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]any{
			"error":       "AI provider is not configured",
			"error_class": agent.ErrorClassOf(err),
		})
		return
	}
	generated, err := provider.Generate(request.Context(), input)
	if err != nil {
		status := http.StatusServiceUnavailable
		if agent.ErrorClassOf(err) == agent.ErrorPermanent && provider.Name() == "mock" {
			status = http.StatusBadRequest
		}
		writeJSON(response, status, map[string]any{
			"error":       err.Error(),
			"error_class": agent.ErrorClassOf(err),
		})
		return
	}
	writeJSON(response, http.StatusOK, generated)
}
