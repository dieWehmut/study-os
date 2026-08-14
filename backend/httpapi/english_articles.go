package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"study-os/backend/agent"
	"study-os/backend/app"
	"study-os/backend/db"
	"study-os/backend/english"
	"study-os/backend/models"
)

type englishArticleResponse struct {
	ID            string                       `json:"id"`
	Title         string                       `json:"title"`
	OriginalTitle string                       `json:"original_title,omitempty"`
	Author        string                       `json:"author,omitempty"`
	SourceName    string                       `json:"source_name,omitempty"`
	SourceURL     string                       `json:"source_url,omitempty"`
	PublishedAt   string                       `json:"published_at,omitempty"`
	OriginalText  string                       `json:"original_text,omitempty"`
	Content       *agent.EnglishArticleContent `json:"content,omitempty"`
	Markdown      string                       `json:"markdown,omitempty"`
	Provider      string                       `json:"provider,omitempty"`
	Model         string                       `json:"model,omitempty"`
	SectionCount  int                          `json:"section_count,omitempty"`
	CreatedAt     string                       `json:"created_at,omitempty"`
	UpdatedAt     string                       `json:"updated_at,omitempty"`
}

type englishArticleCreateInput struct {
	ID            string          `json:"id,omitempty"`
	Title         string          `json:"title,omitempty"`
	OriginalTitle string          `json:"original_title,omitempty"`
	Author        string          `json:"author,omitempty"`
	SourceName    string          `json:"source_name,omitempty"`
	SourceURL     string          `json:"source_url,omitempty"`
	PublishedAt   string          `json:"published_at,omitempty"`
	OriginalText  string          `json:"original_text"`
	Content       json.RawMessage `json:"content"`
	Markdown      string          `json:"markdown,omitempty"`
	Provider      string          `json:"provider,omitempty"`
	Model         string          `json:"model,omitempty"`
}

func handleEnglishArticleGenerate(response http.ResponseWriter, request *http.Request, application *app.App) {
	var input agent.EnglishArticleInput
	request.Body = http.MaxBytesReader(response, request.Body, maxImportJSONBytes)
	if err := decodeRequest(request, &input); err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if strings.TrimSpace(input.OriginalText) == "" {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "original_text is required"})
		return
	}
	provider, err := providerFor(application)
	if err != nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "AI provider is not configured"})
		return
	}
	preview, err := english.NewArticleService(provider).GeneratePreview(request.Context(), input)
	if err != nil {
		writeEnglishArticleError(response, err, false)
		return
	}
	writeJSON(response, http.StatusOK, englishArticleResponseFromPreview(input, preview))
}

func handleEnglishArticleCreate(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	var input englishArticleCreateInput
	request.Body = http.MaxBytesReader(response, request.Body, maxImportJSONBytes)
	if err := decodeRequest(request, &input); err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	content, err := decodeArticleContent(input.Content)
	if err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	normalized, err := english.NormalizeArticle(agent.EnglishArticleInput{
		OriginalText: input.OriginalText, Title: input.Title, OriginalTitle: input.OriginalTitle,
		Author: input.Author, SourceName: input.SourceName, SourceURL: input.SourceURL, PublishedAt: input.PublishedAt,
	}, content)
	if err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	canonical, err := json.Marshal(normalized)
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "encode article content failed"})
		return
	}
	article := models.EnglishArticle{
		ID: input.ID, Title: normalized.Title, OriginalTitle: normalized.Metadata.OriginalTitle,
		Author: normalized.Metadata.Author, SourceName: normalized.Metadata.SourceName,
		SourceURL: normalized.Metadata.SourceURL, PublishedAt: normalized.Metadata.PublishedAt,
		OriginalText: strings.TrimSpace(input.OriginalText), ContentJSON: canonical,
		Markdown: english.CanonicalMarkdown(normalized), Provider: strings.TrimSpace(input.Provider), Model: strings.TrimSpace(input.Model),
	}
	if article.ID == "" {
		article.ID = newRequestID("article")
	}
	if err := application.Store.CreateEnglishArticle(request.Context(), article); err != nil {
		writeEnglishArticleError(response, err, true)
		return
	}
	stored, err := application.Store.GetEnglishArticle(request.Context(), article.ID)
	if err != nil {
		writeEnglishArticleError(response, err, false)
		return
	}
	writeJSON(response, http.StatusCreated, englishArticleResponseFromModel(stored, true))
}

func handleEnglishArticleList(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	items, err := application.Store.ListEnglishArticles(request.Context(), parseLimit(request.URL.Query().Get("limit"), 50, 200))
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "list English articles failed"})
		return
	}
	result := make([]englishArticleResponse, 0, len(items))
	for _, item := range items {
		full, getErr := application.Store.GetEnglishArticle(request.Context(), item.ID)
		if getErr != nil {
			writeEnglishArticleError(response, getErr, false)
			return
		}
		result = append(result, englishArticleResponseFromModel(full, false))
	}
	writeJSON(response, http.StatusOK, map[string]any{"items": result, "count": len(result)})
}

func handleEnglishArticleGet(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	article, err := application.Store.GetEnglishArticle(request.Context(), chi.URLParam(request, "articleID"))
	if err != nil {
		writeEnglishArticleError(response, err, false)
		return
	}
	writeJSON(response, http.StatusOK, englishArticleResponseFromModel(article, true))
}

func handleEnglishArticleRegenerate(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	article, err := application.Store.GetEnglishArticle(request.Context(), chi.URLParam(request, "articleID"))
	if err != nil {
		writeEnglishArticleError(response, err, false)
		return
	}
	provider, err := providerFor(application)
	if err != nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "AI provider is not configured"})
		return
	}
	preview, err := english.NewArticleService(provider).GeneratePreview(request.Context(), agent.EnglishArticleInput{
		OriginalText: article.OriginalText, Title: article.Title, OriginalTitle: article.OriginalTitle,
		Author: article.Author, SourceName: article.SourceName, SourceURL: article.SourceURL, PublishedAt: article.PublishedAt,
	})
	if err != nil {
		writeEnglishArticleError(response, err, false)
		return
	}
	content, err := json.Marshal(preview.Content)
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "encode generated article failed"})
		return
	}
	article.Title = preview.Content.Title
	article.OriginalTitle = preview.Content.Metadata.OriginalTitle
	article.Author = preview.Content.Metadata.Author
	article.SourceName = preview.Content.Metadata.SourceName
	article.SourceURL = preview.Content.Metadata.SourceURL
	article.PublishedAt = preview.Content.Metadata.PublishedAt
	article.ContentJSON = content
	article.Markdown = preview.Markdown
	article.Provider = preview.Provider
	article.Model = preview.Model
	if err := application.Store.ReplaceEnglishArticle(request.Context(), article); err != nil {
		writeEnglishArticleError(response, err, false)
		return
	}
	stored, err := application.Store.GetEnglishArticle(request.Context(), article.ID)
	if err != nil {
		writeEnglishArticleError(response, err, false)
		return
	}
	writeJSON(response, http.StatusOK, englishArticleResponseFromModel(stored, true))
}

func handleEnglishArticleDelete(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	if err := application.Store.DeleteEnglishArticle(request.Context(), chi.URLParam(request, "articleID")); err != nil {
		writeEnglishArticleError(response, err, false)
		return
	}
	response.WriteHeader(http.StatusNoContent)
}

func decodeArticleContent(raw json.RawMessage) (agent.EnglishArticleContent, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return agent.EnglishArticleContent{}, errors.New("content is required")
	}
	var content agent.EnglishArticleContent
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&content); err != nil {
		return agent.EnglishArticleContent{}, errors.New("content must be a structured English article")
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return agent.EnglishArticleContent{}, errors.New("content must contain one JSON value")
	}
	return content, nil
}

func englishArticleResponseFromPreview(input agent.EnglishArticleInput, preview english.Preview) englishArticleResponse {
	return englishArticleResponse{
		Title: preview.Content.Title, OriginalTitle: preview.Content.Metadata.OriginalTitle,
		Author: preview.Content.Metadata.Author, SourceName: preview.Content.Metadata.SourceName,
		SourceURL: preview.Content.Metadata.SourceURL, PublishedAt: preview.Content.Metadata.PublishedAt,
		OriginalText: input.OriginalText, Content: &preview.Content, Markdown: preview.Markdown,
		Provider: preview.Provider, Model: preview.Model, SectionCount: len(preview.Content.Sections),
	}
}

func englishArticleResponseFromModel(article models.EnglishArticle, full bool) englishArticleResponse {
	result := englishArticleResponse{
		ID: article.ID, Title: article.Title, OriginalTitle: article.OriginalTitle, Author: article.Author,
		SourceName: article.SourceName, SourceURL: article.SourceURL, PublishedAt: article.PublishedAt,
		Provider: article.Provider, Model: article.Model, CreatedAt: article.CreatedAt.UTC().Format("2006-01-02T15:04:05.999999999Z"),
		UpdatedAt: article.UpdatedAt.UTC().Format("2006-01-02T15:04:05.999999999Z"),
	}
	if !full {
		if content, err := decodeArticleContent(article.ContentJSON); err == nil {
			result.SectionCount = len(content.Sections)
		}
		return result
	}
	result.OriginalText = article.OriginalText
	result.Markdown = article.Markdown
	if content, err := decodeArticleContent(article.ContentJSON); err == nil {
		result.Content = &content
		result.SectionCount = len(content.Sections)
	}
	return result
}

func writeEnglishArticleError(response http.ResponseWriter, err error, badRequest bool) {
	if errors.Is(err, db.ErrNotFound) {
		writeJSON(response, http.StatusNotFound, map[string]string{"error": err.Error()})
		return
	}
	if badRequest {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if agent.ErrorClassOf(err) == agent.ErrorPermanent {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": err.Error()})
}
