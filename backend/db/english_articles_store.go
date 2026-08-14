package db

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"

	"study-os/backend/models"
)

func (s *Store) CreateEnglishArticle(ctx context.Context, article models.EnglishArticle) error {
	if err := validateEnglishArticle(article); err != nil {
		return err
	}
	createdAt, updatedAt := article.CreatedAt.UTC(), article.UpdatedAt.UTC()
	if createdAt.IsZero() {
		createdAt = nowUTC()
	}
	if updatedAt.IsZero() {
		updatedAt = createdAt
	}
	content := article.ContentJSON
	if len(content) == 0 {
		content = json.RawMessage(`{}`)
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO english_articles(
			id, title, original_title, author, source_name, source_url, published_at,
			original_text, content_json, markdown, provider, model, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		article.ID, article.Title, article.OriginalTitle, article.Author, article.SourceName,
		article.SourceURL, article.PublishedAt, article.OriginalText, string(content), article.Markdown,
		article.Provider, article.Model, formatTime(createdAt), formatTime(updatedAt))
	return err
}

func (s *Store) ReplaceEnglishArticle(ctx context.Context, article models.EnglishArticle) error {
	if err := validateEnglishArticle(article); err != nil {
		return err
	}
	updatedAt := article.UpdatedAt.UTC()
	if updatedAt.IsZero() {
		updatedAt = nowUTC()
	}
	content := article.ContentJSON
	if len(content) == 0 {
		content = json.RawMessage(`{}`)
	}
	result, err := s.db.ExecContext(ctx, `
		UPDATE english_articles SET
			title = ?, original_title = ?, author = ?, source_name = ?, source_url = ?,
			published_at = ?, original_text = ?, content_json = ?, markdown = ?,
			provider = ?, model = ?, updated_at = ?
		WHERE id = ?`,
		article.Title, article.OriginalTitle, article.Author, article.SourceName, article.SourceURL,
		article.PublishedAt, article.OriginalText, string(content), article.Markdown,
		article.Provider, article.Model, formatTime(updatedAt), article.ID)
	if err != nil {
		return err
	}
	return requireChanged(result, "english article")
}

func (s *Store) GetEnglishArticle(ctx context.Context, id string) (models.EnglishArticle, error) {
	article, err := scanEnglishArticle(s.db.QueryRowContext(ctx, englishArticleSelect+` WHERE id = ?`, id), true)
	if err != nil {
		return models.EnglishArticle{}, mapNotFound(err, "english article")
	}
	return article, nil
}

func (s *Store) ListEnglishArticles(ctx context.Context, limit int) ([]models.EnglishArticle, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, title, original_title, author, source_name, source_url, published_at,
		       provider, model, created_at, updated_at
		FROM english_articles
		ORDER BY updated_at DESC, id DESC
		LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	articles := make([]models.EnglishArticle, 0, limit)
	for rows.Next() {
		var article models.EnglishArticle
		var createdAt, updatedAt string
		if err := rows.Scan(&article.ID, &article.Title, &article.OriginalTitle, &article.Author,
			&article.SourceName, &article.SourceURL, &article.PublishedAt, &article.Provider,
			&article.Model, &createdAt, &updatedAt); err != nil {
			return nil, err
		}
		var err error
		if article.CreatedAt, err = parseTime(createdAt); err != nil {
			return nil, fmt.Errorf("parse english article created time: %w", err)
		}
		if article.UpdatedAt, err = parseTime(updatedAt); err != nil {
			return nil, fmt.Errorf("parse english article updated time: %w", err)
		}
		articles = append(articles, article)
	}
	return articles, rows.Err()
}

func (s *Store) DeleteEnglishArticle(ctx context.Context, id string) error {
	result, err := s.db.ExecContext(ctx, `DELETE FROM english_articles WHERE id = ?`, id)
	if err != nil {
		return err
	}
	return requireChanged(result, "english article")
}

const englishArticleSelect = `
	SELECT id, title, original_title, author, source_name, source_url, published_at,
	       original_text, content_json, markdown, provider, model, created_at, updated_at
	FROM english_articles`

func scanEnglishArticle(row interface{ Scan(...any) error }, full bool) (models.EnglishArticle, error) {
	var article models.EnglishArticle
	var createdAt, updatedAt string
	if full {
		var content string
		if err := row.Scan(&article.ID, &article.Title, &article.OriginalTitle, &article.Author,
			&article.SourceName, &article.SourceURL, &article.PublishedAt, &article.OriginalText,
			&content, &article.Markdown, &article.Provider, &article.Model, &createdAt, &updatedAt); err != nil {
			return models.EnglishArticle{}, err
		}
		article.ContentJSON = json.RawMessage(content)
	} else if err := row.Scan(&article.ID, &article.Title, &article.OriginalTitle, &article.Author,
		&article.SourceName, &article.SourceURL, &article.PublishedAt, &article.Provider,
		&article.Model, &createdAt, &updatedAt); err != nil {
		return models.EnglishArticle{}, err
	}
	var err error
	if article.CreatedAt, err = parseTime(createdAt); err != nil {
		return models.EnglishArticle{}, fmt.Errorf("parse english article created time: %w", err)
	}
	if article.UpdatedAt, err = parseTime(updatedAt); err != nil {
		return models.EnglishArticle{}, fmt.Errorf("parse english article updated time: %w", err)
	}
	return article, nil
}

func validateEnglishArticle(article models.EnglishArticle) error {
	if strings.TrimSpace(article.ID) == "" {
		return fmt.Errorf("english article id is required")
	}
	if strings.TrimSpace(article.Title) == "" {
		return fmt.Errorf("english article title is required")
	}
	if strings.TrimSpace(article.OriginalText) == "" {
		return fmt.Errorf("english article original text is required")
	}
	if strings.TrimSpace(article.Markdown) == "" {
		return fmt.Errorf("english article markdown is required")
	}
	return nil
}

var _ interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
} = (*sql.DB)(nil)
