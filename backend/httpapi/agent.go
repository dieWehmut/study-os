package httpapi

import (
	"net/http"
	"strings"

	"study-os/backend/agent"
	"study-os/backend/app"
)

func providerFor(application *app.App) (agent.Provider, error) {
	if application == nil {
		return nil, agent.NewProviderError(agent.ErrorConfigMissing, "application unavailable")
	}
	switch strings.ToLower(strings.TrimSpace(application.Config.AIProvider)) {
	case "", "mock":
		return agent.NewMockProvider(), nil
	case "openai":
		return agent.NewOpenAIProvider(agent.OpenAIConfig{
			APIKey:  application.Config.OpenAIAPIKey,
			BaseURL: application.Config.OpenAIBaseURL,
			Model:   application.Config.OpenAIModel,
		})
	default:
		return nil, agent.NewProviderError(agent.ErrorConfigMissing, "configured AI provider is unsupported")
	}
}

func handleAgentStatus(response http.ResponseWriter, request *http.Request, application *app.App) {
	provider, err := providerFor(application)
	configured := err == nil
	providerName := ""
	if application != nil {
		providerName = strings.ToLower(strings.TrimSpace(application.Config.AIProvider))
	}
	if providerName == "" {
		providerName = "mock"
	}
	if provider != nil {
		providerName = provider.Name()
	}
	payload := map[string]any{
		"provider":   providerName,
		"configured": configured,
		"available":  configured && providerName == "mock",
		"offline":    providerName == "mock",
	}
	if err != nil {
		payload["error_class"] = agent.ErrorClassOf(err)
	}
	writeJSON(response, http.StatusOK, payload)
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
