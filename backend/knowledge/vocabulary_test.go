package knowledge_test

import (
	"context"
	"errors"
	"testing"

	"study-os/backend/agent"
	"study-os/backend/db"
	"study-os/backend/knowledge"
	"study-os/backend/models"
)

type fakeStore struct {
	items     map[string]models.KnowledgeItem
	created   []models.KnowledgeItem
	createErr error
	findCalls int
	getCalls  int
}

func (s *fakeStore) FindKnowledgeItemByExactTerm(_ context.Context, term, subject string) (models.KnowledgeItem, error) {
	s.findCalls++
	for _, item := range s.items {
		if item.Term == term && item.Subject == subject {
			return item, nil
		}
	}
	return models.KnowledgeItem{}, db.ErrNotFound
}

func (s *fakeStore) CreateKnowledgeItem(_ context.Context, item models.KnowledgeItem) error {
	if s.createErr != nil {
		return s.createErr
	}
	if s.items == nil {
		s.items = map[string]models.KnowledgeItem{}
	}
	s.items[item.ID] = item
	s.created = append(s.created, item)
	return nil
}

func (s *fakeStore) GetKnowledgeItem(_ context.Context, id string) (models.KnowledgeItem, error) {
	s.getCalls++
	item, ok := s.items[id]
	if !ok {
		return models.KnowledgeItem{}, db.ErrNotFound
	}
	return item, nil
}

type countingProvider struct {
	calls int
}

func (p *countingProvider) Name() string { return "test" }

func (p *countingProvider) Generate(_ context.Context, request agent.Request) (agent.Response, error) {
	p.calls++
	return agent.Response{Kind: agent.KindWordWiki, WordWiki: &agent.WordWikiOutput{
		DetailedMarkdown:  "# complicated\n\nA detailed note.",
		ConciseDefinition: "complex or difficult to understand",
		PartOfSpeech:      "adjective",
		Example:           "A complicated man.",
	}}, nil
}

func TestLookupVocabularyUsesExactLocalItemBeforeProvider(t *testing.T) {
	store := &fakeStore{items: map[string]models.KnowledgeItem{
		"local": {ID: "local", Term: "abandon", Subject: "english", ConciseDefinition: "leave"},
	}}
	provider := &countingProvider{}
	result, err := knowledge.LookupVocabulary(context.Background(), store, provider, knowledge.LookupInput{
		Term: " ABANDON ", Context: "They had to abandon the car.", Kind: knowledge.KindWord,
	})
	if err != nil {
		t.Fatalf("lookup: %v", err)
	}
	if result.Source != knowledge.SourceExisting || result.Item.ID != "local" {
		t.Fatalf("result = %#v", result)
	}
	if provider.calls != 0 {
		t.Fatalf("provider calls = %d, want 0", provider.calls)
	}
}

func TestLookupVocabularyGeneratesDeterministicUnscheduledItem(t *testing.T) {
	store := &fakeStore{}
	provider := &countingProvider{}
	input := knowledge.LookupInput{Term: "Complicated", Context: "A complicated man walked in.", Kind: knowledge.KindWord}
	first, err := knowledge.LookupVocabulary(context.Background(), store, provider, input)
	if err != nil {
		t.Fatalf("first lookup: %v", err)
	}
	if first.Source != knowledge.SourceGenerated || first.Item.ID == "" {
		t.Fatalf("first result = %#v", first)
	}
	if first.Item.Subject != "english" || first.Item.ItemType != "word_wiki" {
		t.Fatalf("generated item metadata = %#v", first.Item)
	}
	if len(first.Item.Tags) != 2 || first.Item.Tags[0] != "reading-vocabulary" || first.Item.Tags[1] != "ai-generated" {
		t.Fatalf("generated tags = %#v", first.Item.Tags)
	}
	if provider.calls != 1 || len(store.created) != 1 {
		t.Fatalf("calls=%d created=%d", provider.calls, len(store.created))
	}
	second, err := knowledge.LookupVocabulary(context.Background(), store, provider, input)
	if err != nil {
		t.Fatalf("second lookup: %v", err)
	}
	if second.Item.ID != first.Item.ID || second.Source != knowledge.SourceExisting || provider.calls != 1 {
		t.Fatalf("second result=%#v calls=%d", second, provider.calls)
	}
}

func TestLookupVocabularyRejectsInvalidBoundsAndKinds(t *testing.T) {
	store := &fakeStore{}
	provider := &countingProvider{}
	cases := []knowledge.LookupInput{
		{Term: "", Context: "context", Kind: knowledge.KindWord},
		{Term: "word", Context: "", Kind: knowledge.KindWord},
		{Term: "word", Context: "context", Kind: "phrase"},
	}
	for _, input := range cases {
		if _, err := knowledge.LookupVocabulary(context.Background(), store, provider, input); !errors.Is(err, knowledge.ErrInvalidInput) {
			t.Fatalf("input %#v error=%v, want ErrInvalidInput", input, err)
		}
	}
}

func TestLookupVocabularyReturnsProviderErrorWithoutWriting(t *testing.T) {
	store := &fakeStore{}
	if _, err := knowledge.LookupVocabulary(context.Background(), store, nil, knowledge.LookupInput{
		Term: "word", Context: "a word in context", Kind: knowledge.KindWord,
	}); !errors.Is(err, knowledge.ErrProvider) {
		t.Fatalf("error=%v, want ErrProvider", err)
	}
	if len(store.created) != 0 {
		t.Fatalf("created=%d", len(store.created))
	}
}
