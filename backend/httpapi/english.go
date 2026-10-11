package httpapi

import (
	"net/http"
	"strings"

	"study-os/backend/app"
	"study-os/backend/english"
	"study-os/backend/models"
)

func handleGroups(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	groups, err := application.Store.ListKnowledgeGroups(request.Context())
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "读取知识分组失败"})
		return
	}
	// How many items are in each group, because the page draws them as a list with
	// numbers -- a group name on its own does not say whether it is worth opening.
	// Counting uses the same store call the `?group=` filter uses, so the number and
	// the list it filters can never disagree. A group that fails to count reads as
	// "unknown" (-1) rather than as zero: the dropdown still needs it.
	for index := range groups {
		counted, countErr := application.Store.CountItemsByGroup(request.Context(), groups[index].ID, models.KnowledgeListOptions{})
		if countErr != nil {
			groups[index].ItemCount = -1
			continue
		}
		groups[index].ItemCount = counted
	}
	writeJSON(response, http.StatusOK, map[string]any{"items": groups, "count": len(groups)})
}

func handleEnglishProcess(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	cfg := english.CleanConfig{
		ExcludeLevels: settingList(request, application, "english.exclude_levels"),
		ExcludeTags:   settingList(request, application, "english.exclude_tags"),
	}
	result, err := english.NewPipeline(application.Store).Process(request.Context(), cfg)
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "english processing failed"})
		return
	}
	writeJSON(response, http.StatusOK, result)
}

func handleEnglishWiki(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	var input struct {
		ItemIDs []string `json:"item_ids"`
	}
	request.Body = http.MaxBytesReader(response, request.Body, maxImportJSONBytes)
	if err := decodeRequest(request, &input); err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if len(input.ItemIDs) == 0 {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "item_ids is required"})
		return
	}
	provider, err := providerFor(application)
	if err != nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "AI provider is not configured"})
		return
	}
	result, err := english.NewPipeline(application.Store).GenerateWiki(request.Context(), input.ItemIDs, provider)
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "wiki generation failed"})
		return
	}
	writeJSON(response, http.StatusOK, result)
}

func settingList(request *http.Request, application *app.App, key string) []string {
	value, err := application.Store.GetSetting(request.Context(), key)
	if err != nil || strings.TrimSpace(value) == "" {
		return nil
	}
	parts := strings.Split(value, ",")
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		if normalized := strings.TrimSpace(part); normalized != "" {
			result = append(result, normalized)
		}
	}
	return result
}
