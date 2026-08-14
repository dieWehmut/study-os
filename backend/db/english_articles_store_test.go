package db_test

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"study-os/backend/db"
	"study-os/backend/models"
)

func TestEnglishArticleStoreLifecycle(t *testing.T) {
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "study.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	var tableCount, indexCount int
	if err := store.SQL().QueryRowContext(ctx,
		`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'english_articles'`,
	).Scan(&tableCount); err != nil {
		t.Fatalf("inspect article table: %v", err)
	}
	if tableCount != 1 {
		t.Fatalf("english_articles table count = %d, want 1", tableCount)
	}
	if err := store.SQL().QueryRowContext(ctx,
		`SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'english_articles_updated_idx'`,
	).Scan(&indexCount); err != nil {
		t.Fatalf("inspect article index: %v", err)
	}
	if indexCount != 1 {
		t.Fatalf("english article index count = %d, want 1", indexCount)
	}

	createdAt := time.Date(2026, 8, 15, 8, 30, 0, 0, time.UTC)
	first := models.EnglishArticle{
		ID:            "article-first",
		Title:         "没有成功的铁律",
		OriginalTitle: "There Are No Rules for Success",
		Author:        "Andy Kessler",
		SourceName:    "The Wall Street Journal",
		SourceURL:     "https://example.com/no-rules",
		PublishedAt:   "2026-01-06",
		OriginalText:  "There are no rules. Do your thing.",
		ContentJSON:   json.RawMessage(`{"title":"没有成功的铁律","sections":[{"title":"打破规则"}]}`),
		Markdown:      "# 没有成功的铁律\n\n## 打破规则\n",
		Provider:      "mock",
		Model:         "mock-article-v1",
		CreatedAt:     createdAt,
		UpdatedAt:     createdAt,
	}
	if err := store.CreateEnglishArticle(ctx, first); err != nil {
		t.Fatalf("create first article: %v", err)
	}

	second := first
	second.ID = "article-second"
	second.Title = "功能性冻结是什么"
	second.ContentJSON = json.RawMessage(`{"title":"功能性冻结是什么","sections":[{"title":"定义"}]}`)
	second.Markdown = "# 功能性冻结是什么\n\n## 定义\n"
	second.CreatedAt = createdAt.Add(time.Hour)
	second.UpdatedAt = second.CreatedAt
	if err := store.CreateEnglishArticle(ctx, second); err != nil {
		t.Fatalf("create second article: %v", err)
	}

	articles, err := store.ListEnglishArticles(ctx, 20)
	if err != nil {
		t.Fatalf("list articles: %v", err)
	}
	if len(articles) != 2 || articles[0].ID != second.ID || articles[1].ID != first.ID {
		t.Fatalf("articles = %#v, want newest first", articles)
	}
	if articles[0].OriginalText != "" || len(articles[0].ContentJSON) != 0 || articles[0].Markdown != "" {
		t.Fatalf("list returned full article payload: %#v", articles[0])
	}

	stored, err := store.GetEnglishArticle(ctx, first.ID)
	if err != nil {
		t.Fatalf("get article: %v", err)
	}
	if stored.Title != first.Title || stored.OriginalText != first.OriginalText || string(stored.ContentJSON) != string(first.ContentJSON) || stored.Markdown != first.Markdown {
		t.Fatalf("stored article = %#v", stored)
	}
	if !stored.CreatedAt.Equal(first.CreatedAt) || !stored.UpdatedAt.Equal(first.UpdatedAt) {
		t.Fatalf("stored times = %v / %v", stored.CreatedAt, stored.UpdatedAt)
	}

	first.Title = "成功没有固定公式"
	first.ContentJSON = json.RawMessage(`{"title":"成功没有固定公式","sections":[{"title":"创造惊喜"}]}`)
	first.Markdown = "# 成功没有固定公式\n\n## 创造惊喜\n"
	first.Provider = "deepseek"
	first.Model = "deepseek-chat"
	first.UpdatedAt = createdAt.Add(2 * time.Hour)
	if err := store.ReplaceEnglishArticle(ctx, first); err != nil {
		t.Fatalf("replace article: %v", err)
	}
	updated, err := store.GetEnglishArticle(ctx, first.ID)
	if err != nil {
		t.Fatalf("get replaced article: %v", err)
	}
	if updated.Title != first.Title || updated.Provider != "deepseek" || updated.Model != "deepseek-chat" || !updated.CreatedAt.Equal(createdAt) || !updated.UpdatedAt.Equal(first.UpdatedAt) {
		t.Fatalf("replaced article = %#v", updated)
	}

	articles, err = store.ListEnglishArticles(ctx, 1)
	if err != nil {
		t.Fatalf("list limited articles: %v", err)
	}
	if len(articles) != 1 || articles[0].ID != first.ID {
		t.Fatalf("limited articles = %#v, want updated first article", articles)
	}

	if err := store.DeleteEnglishArticle(ctx, first.ID); err != nil {
		t.Fatalf("delete article: %v", err)
	}
	if _, err := store.GetEnglishArticle(ctx, first.ID); !errors.Is(err, db.ErrNotFound) {
		t.Fatalf("get deleted article error = %v, want ErrNotFound", err)
	}
	if err := store.ReplaceEnglishArticle(ctx, first); !errors.Is(err, db.ErrNotFound) {
		t.Fatalf("replace deleted article error = %v, want ErrNotFound", err)
	}
	if err := store.DeleteEnglishArticle(ctx, first.ID); !errors.Is(err, db.ErrNotFound) {
		t.Fatalf("delete missing article error = %v, want ErrNotFound", err)
	}
}
