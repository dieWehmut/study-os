package db_test

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"study-os/backend/db"
	"study-os/backend/models"
)

func TestListDistractorTermsExcludesCurrentItemAndFiltersByType(t *testing.T) {
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "study.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	now := time.Date(2026, 8, 3, 12, 0, 0, 0, time.UTC)
	for _, item := range []models.KnowledgeItem{
		{ID: "k1", ItemType: "word_sense", Term: "abandon", ConciseDefinition: "放弃", CreatedAt: now, UpdatedAt: now},
		{ID: "k2", ItemType: "word_sense", Term: "resilient", ConciseDefinition: "有韧性的", CreatedAt: now, UpdatedAt: now},
		{ID: "k3", ItemType: "word_sense", Term: "fluent", ConciseDefinition: "流利的", CreatedAt: now, UpdatedAt: now},
		{ID: "k4", ItemType: "phrase", Term: "give up", ConciseDefinition: "放弃", CreatedAt: now, UpdatedAt: now},
		{ID: "k5", ItemType: "classic_text", Term: "论语十二章", ConciseDefinition: "经典", CreatedAt: now, UpdatedAt: now},
	} {
		if err := store.CreateKnowledgeItem(ctx, item); err != nil {
			t.Fatalf("create item: %v", err)
		}
	}

	terms, err := store.ListDistractorTerms(ctx, "k1", 3)
	if err != nil {
		t.Fatalf("list distractors: %v", err)
	}
	if len(terms) != 3 {
		t.Fatalf("distractors = %#v, want 3", terms)
	}
	for _, term := range terms {
		if term == "abandon" {
			t.Fatalf("distractors must exclude the current term: %#v", terms)
		}
		if term == "论语十二章" {
			t.Fatalf("distractors must exclude non-word item types: %#v", terms)
		}
	}
	contains := false
	for _, term := range terms {
		if term == "give up" {
			contains = true
		}
	}
	if !contains {
		t.Fatalf("phrase distractors missing: %#v", terms)
	}

	few, err := store.ListDistractorTerms(ctx, "k1", 100)
	if err != nil {
		t.Fatalf("list many distractors: %v", err)
	}
	if len(few) != 3 {
		t.Fatalf("distractor count = %d, want 3 available", len(few))
	}
}
