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
	return agent.NewProvider(agent.ProviderConfig{
		Active: application.Config.ActiveProvider,
		DeepSeek: agent.DeepSeekConfig{
			APIKey:         application.Config.DeepSeek.APIKey,
			BaseURL:        application.Config.DeepSeek.BaseURL,
			Model:          application.Config.DeepSeek.Model,
			ReasoningModel: application.Config.DeepSeek.ReasoningModel,
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

	updates := make(map[string]string)
	switch provider {
	case "deepseek":
		if input.APIKey != nil {
			updates["DEEPSEEK_API_KEY"] = strings.TrimSpace(*input.APIKey)
		}
		if input.BaseURL != nil {
			updates["DEEPSEEK_BASE_URL"] = strings.TrimSpace(*input.BaseURL)
		}
		if input.Model != nil {
			updates["DEEPSEEK_MODEL"] = strings.TrimSpace(*input.Model)
		}
		if input.ReasoningModel != nil {
			updates["DEEPSEEK_REASONING_MODEL"] = strings.TrimSpace(*input.ReasoningModel)
		}
	case "dashscope":
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
	if value, ok := updates["DEEPSEEK_API_KEY"]; ok {
		application.Config.DeepSeek.APIKey = value
	}
	if value, ok := updates["DEEPSEEK_BASE_URL"]; ok {
		application.Config.DeepSeek.BaseURL = value
	}
	if value, ok := updates["DEEPSEEK_MODEL"]; ok {
		application.Config.DeepSeek.Model = value
	}
	if value, ok := updates["DEEPSEEK_REASONING_MODEL"]; ok {
		application.Config.DeepSeek.ReasoningModel = value
	}
	if value, ok := updates["DASHSCOPE_API_KEY"]; ok {
		application.Config.DashScopeAPIKey = value
	}
	if value, ok := updates["DASHSCOPE_TTS_VOICE"]; ok {
		application.Config.DashScopeVoice = value
	}

	payload := map[string]any{"provider": provider}
	switch provider {
	case "deepseek":
		payload["key_configured"] = application.Config.DeepSeek.APIKey != ""
		payload["base_url"] = application.Config.DeepSeek.BaseURL
		payload["model"] = application.Config.DeepSeek.Model
		payload["reasoning_model"] = application.Config.DeepSeek.ReasoningModel
	case "dashscope":
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
	provider, err := agent.NewProvider(agent.ProviderConfig{
		Active: providerName,
		DeepSeek: agent.DeepSeekConfig{
			APIKey:         application.Config.DeepSeek.APIKey,
			BaseURL:        application.Config.DeepSeek.BaseURL,
			Model:          application.Config.DeepSeek.Model,
			ReasoningModel: application.Config.DeepSeek.ReasoningModel,
		},
	})
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
