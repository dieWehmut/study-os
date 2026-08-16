// Package knowledge contains application services for the knowledge library.
package knowledge

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"golang.org/x/text/unicode/norm"

	"study-os/backend/agent"
	"study-os/backend/db"
	"study-os/backend/models"
)

type Kind string

const (
	KindWord       Kind = "word"
	KindExpression Kind = "expression"
)

type Source string

const (
	SourceExisting  Source = "existing"
	SourceGenerated Source = "generated"
)

var (
	ErrInvalidInput = errors.New("invalid vocabulary lookup input")
	ErrProvider     = errors.New("vocabulary provider unavailable")
)

type LookupInput struct {
	Term    string
	Context string
	Kind    Kind
}

type LookupResult struct {
	Source Source               `json:"source"`
	Item   models.KnowledgeItem `json:"item"`
}

type Store interface {
	FindKnowledgeItemByExactTerm(context.Context, string, string) (models.KnowledgeItem, error)
	CreateKnowledgeItem(context.Context, models.KnowledgeItem) error
	GetKnowledgeItem(context.Context, string) (models.KnowledgeItem, error)
}

const (
	maxTermRunes    = 80
	maxContextRunes = 2000
)

// LookupVocabulary resolves an exact English term locally first. Only a true
// miss invokes the provider; generated rows have deterministic IDs and never
// create review prompts, so repeated clicks are idempotent.
func LookupVocabulary(ctx context.Context, store Store, provider agent.Provider, input LookupInput) (LookupResult, error) {
	if store == nil {
		return LookupResult{}, fmt.Errorf("%w: store is unavailable", ErrInvalidInput)
	}
	term, contextText, kind, err := normalizeInput(input)
	if err != nil {
		return LookupResult{}, err
	}
	if existing, findErr := store.FindKnowledgeItemByExactTerm(ctx, term, "english"); findErr == nil {
		return LookupResult{Source: SourceExisting, Item: existing}, nil
	} else if !errors.Is(findErr, db.ErrNotFound) {
		return LookupResult{}, fmt.Errorf("find vocabulary item: %w", findErr)
	}
	if provider == nil {
		return LookupResult{}, fmt.Errorf("%w: AI provider is unavailable", ErrProvider)
	}

	response, err := provider.Generate(ctx, agent.Request{
		Kind:     agent.KindWordWiki,
		WordWiki: &agent.WordWikiInput{Term: term, Context: contextText},
	})
	if err != nil {
		return LookupResult{}, fmt.Errorf("%w: generate vocabulary item: %w", ErrProvider, err)
	}
	if response.WordWiki == nil {
		return LookupResult{}, fmt.Errorf("generate vocabulary item: empty word wiki response")
	}
	output := response.WordWiki
	definition := strings.TrimSpace(output.ConciseDefinition)
	markdown := strings.TrimSpace(output.DetailedMarkdown)
	if definition == "" || markdown == "" {
		return LookupResult{}, fmt.Errorf("generate vocabulary item: incomplete word wiki response")
	}
	id := deterministicID(kind, term)
	now := time.Now().UTC()
	item := models.KnowledgeItem{
		ID:                id,
		ItemType:          "word_wiki",
		Term:              term,
		PartOfSpeech:      strings.TrimSpace(output.PartOfSpeech),
		Pronunciation:     strings.TrimSpace(output.Pronunciation),
		ConciseDefinition: definition,
		DetailedMarkdown:  markdown,
		Example:           strings.TrimSpace(output.Example),
		Subject:           "english",
		Tags:              []string{"reading-vocabulary", "ai-generated"},
		CreatedAt:         now,
		UpdatedAt:         now,
	}
	if err := store.CreateKnowledgeItem(ctx, item); err != nil {
		// Another request may have won the same deterministic insert. Return the
		// winner rather than surfacing a transient uniqueness error.
		if existing, getErr := store.GetKnowledgeItem(ctx, id); getErr == nil {
			return LookupResult{Source: SourceExisting, Item: existing}, nil
		}
		return LookupResult{}, fmt.Errorf("save generated vocabulary item: %w", err)
	}
	return LookupResult{Source: SourceGenerated, Item: item}, nil
}

func normalizeInput(input LookupInput) (string, string, Kind, error) {
	term := normalizeTerm(input.Term)
	contextText := normalizeContext(input.Context)
	if term == "" || utf8.RuneCountInString(term) > maxTermRunes {
		return "", "", "", fmt.Errorf("%w: term must be 1-%d characters", ErrInvalidInput, maxTermRunes)
	}
	if contextText == "" || utf8.RuneCountInString(contextText) > maxContextRunes {
		return "", "", "", fmt.Errorf("%w: context must be 1-%d characters", ErrInvalidInput, maxContextRunes)
	}
	kind := Kind(strings.ToLower(strings.TrimSpace(string(input.Kind))))
	if kind != KindWord && kind != KindExpression {
		return "", "", "", fmt.Errorf("%w: kind must be word or expression", ErrInvalidInput)
	}
	return term, contextText, kind, nil
}

func normalizeTerm(value string) string {
	value = norm.NFKC.String(value)
	return strings.ToLower(strings.Join(strings.Fields(strings.TrimSpace(value)), " "))
}

func normalizeContext(value string) string {
	value = norm.NFKC.String(value)
	return strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
}

func deterministicID(kind Kind, term string) string {
	sum := sha256.Sum256([]byte(string(kind) + "\x00" + term))
	return "vocab-" + hex.EncodeToString(sum[:])[:16]
}
