package english_test

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"study-os/backend/agent"
	"study-os/backend/db"
	"study-os/backend/english"
	"study-os/backend/models"
)

func nowTime() time.Time {
	return time.Date(2026, 8, 3, 12, 0, 0, 0, time.UTC)
}

func createItem(t *testing.T, store *db.Store, item models.KnowledgeItem) {
	t.Helper()
	if err := store.CreateKnowledgeItem(context.Background(), item); err != nil {
		t.Fatalf("create knowledge item %q: %v", item.ID, err)
	}
}

func openStore(t *testing.T) *db.Store {
	t.Helper()
	store, err := db.Open(context.Background(), filepath.Join(t.TempDir(), "study.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store
}

func TestProcessFiltersAndGroupsEnglishItems(t *testing.T) {
	ctx := context.Background()
	store := openStore(t)
	createItem(t, store, models.KnowledgeItem{ID: "k-abandon", ItemType: "word_sense", Term: "abandon", ConciseDefinition: "放弃", Level: "CET4", CreatedAt: nowTime(), UpdatedAt: nowTime()})
	createItem(t, store, models.KnowledgeItem{ID: "k-abandoned", ItemType: "word_sense", Term: "abandoned", ConciseDefinition: "被抛弃的", Level: "CET4", CreatedAt: nowTime(), UpdatedAt: nowTime()})
	createItem(t, store, models.KnowledgeItem{ID: "k-abstruse", ItemType: "word_sense", Term: "abstruse", ConciseDefinition: "深奥的", Level: "GRE", CreatedAt: nowTime(), UpdatedAt: nowTime()})
	createItem(t, store, models.KnowledgeItem{ID: "k-fluent", ItemType: "word_sense", Term: "fluent", ConciseDefinition: "流利的", Tags: []string{"advanced"}, CreatedAt: nowTime(), UpdatedAt: nowTime()})

	pipeline := english.NewPipeline(store)
	result, err := pipeline.Process(ctx, english.CleanConfig{
		ExcludeLevels: []string{"gre"},
		ExcludeTags:   []string{"advanced"},
	})
	if err != nil {
		t.Fatalf("process: %v", err)
	}
	if result.Scanned != 4 || result.Skipped != 0 || result.Excluded != 2 {
		t.Fatalf("process result = %#v", result)
	}
	if result.FamiliesCreated != 1 || result.ItemsLinked != 2 || result.Groups != 1 {
		t.Fatalf("group result = %#v", result)
	}
	groups, err := store.ListKnowledgeGroups(ctx)
	if err != nil {
		t.Fatalf("list groups: %v", err)
	}
	if len(groups) != 1 || groups[0].Kind != "word_family" {
		t.Fatalf("groups = %#v", groups)
	}
	items, err := store.ListItemsByGroup(ctx, groups[0].ID, models.KnowledgeListOptions{Limit: 10})
	if err != nil {
		t.Fatalf("list group items: %v", err)
	}
	if len(items) != 2 {
		t.Fatalf("group items = %#v", items)
	}

	second, err := pipeline.Process(ctx, english.CleanConfig{
		ExcludeLevels: []string{"gre"},
		ExcludeTags:   []string{"advanced"},
	})
	if err != nil {
		t.Fatalf("second process: %v", err)
	}
	if second.FamiliesCreated != 0 || second.ItemsLinked != 0 {
		t.Fatalf("second run is not idempotent: %#v", second)
	}
}

func TestProcessSkipsNonEnglishItemTypes(t *testing.T) {
	ctx := context.Background()
	store := openStore(t)
	createItem(t, store, models.KnowledgeItem{ID: "k-classic", ItemType: "classic_text", Term: "论语", ConciseDefinition: "经典", CreatedAt: nowTime(), UpdatedAt: nowTime()})
	createItem(t, store, models.KnowledgeItem{ID: "k-word", ItemType: "word_sense", Term: "abandon", ConciseDefinition: "放弃", CreatedAt: nowTime(), UpdatedAt: nowTime()})

	result, err := english.NewPipeline(store).Process(ctx, english.CleanConfig{})
	if err != nil {
		t.Fatalf("process: %v", err)
	}
	if result.Scanned != 2 || result.Skipped != 1 || result.Groups != 1 {
		t.Fatalf("process result = %#v", result)
	}
}

func TestGenerateWikiWritesDetailedMarkdown(t *testing.T) {
	ctx := context.Background()
	store := openStore(t)
	createItem(t, store, models.KnowledgeItem{ID: "k-abandon", ItemType: "word_sense", Term: "abandon", ConciseDefinition: "放弃", CreatedAt: nowTime(), UpdatedAt: nowTime()})

	result, err := english.NewPipeline(store).GenerateWiki(ctx, []string{"k-abandon"}, agent.NewMockProvider())
	if err != nil {
		t.Fatalf("generate wiki: %v", err)
	}
	if result.Generated != 1 || len(result.Failed) != 0 {
		t.Fatalf("wiki result = %#v", result)
	}
	item, err := store.GetKnowledgeItem(ctx, "k-abandon")
	if err != nil {
		t.Fatalf("get item: %v", err)
	}
	if item.DetailedMarkdown == "" || item.DetailedMarkdown[0:2] != "##" {
		t.Fatalf("detailed markdown = %q", item.DetailedMarkdown)
	}
}

type failingProvider struct{}

func (failingProvider) Name() string { return "failing" }
func (failingProvider) Generate(context.Context, agent.Request) (agent.Response, error) {
	return agent.Response{}, errors.New("provider unavailable")
}

func TestGenerateWikiRecordsFailures(t *testing.T) {
	ctx := context.Background()
	store := openStore(t)
	createItem(t, store, models.KnowledgeItem{ID: "k-abandon", ItemType: "word_sense", Term: "abandon", ConciseDefinition: "放弃", CreatedAt: nowTime(), UpdatedAt: nowTime()})

	result, err := english.NewPipeline(store).GenerateWiki(ctx, []string{"k-abandon"}, failingProvider{})
	if err != nil {
		t.Fatalf("generate wiki: %v", err)
	}
	if result.Generated != 0 || len(result.Failed) != 1 || result.Failed[0] != "k-abandon" {
		t.Fatalf("wiki result = %#v", result)
	}
}
