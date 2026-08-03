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
