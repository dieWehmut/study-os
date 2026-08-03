// Package english implements the vocabulary cleaning pipeline: filtering
// advanced or unwanted entries, compressing senses into word-family groups,
// and generating per-word wiki content through the agent provider.
package english

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"sort"
	"strings"
	"time"

	"study-os/backend/agent"
	"study-os/backend/db"
	"study-os/backend/models"
)

type CleanConfig struct {
	ExcludeLevels []string
	ExcludeTags   []string
}

type ProcessResult struct {
	Scanned         int      `json:"scanned"`
	Skipped         int      `json:"skipped"`
	Excluded        int      `json:"excluded"`
	FamiliesCreated int      `json:"families_created"`
	ItemsLinked     int      `json:"items_linked"`
	Groups          int      `json:"groups"`
	ExcludedItemIDs []string `json:"excluded_item_ids,omitempty"`
}

type WikiResult struct {
	Generated int      `json:"generated"`
	Failed    []string `json:"failed,omitempty"`
}

type Pipeline struct {
	store *db.Store
}

func NewPipeline(store *db.Store) *Pipeline {
	return &Pipeline{store: store}
}

// Process filters non-word items and configured exclusions, then groups the
// remaining English word items by lemma into word-family groups. It never
// deletes data; filtering only affects grouping and later enrichment stages.
func (p *Pipeline) Process(ctx context.Context, cfg CleanConfig) (ProcessResult, error) {
	items, err := listAllItems(ctx, p.store)
	if err != nil {
		return ProcessResult{}, err
	}
	excludeLevels := lowerSet(cfg.ExcludeLevels)
	excludeTags := lowerSet(cfg.ExcludeTags)
	families := make(map[string][]models.KnowledgeItem)
	result := ProcessResult{}
	for _, item := range items {
		result.Scanned++
		if !isWordItem(item.ItemType) {
			result.Skipped++
			continue
		}
		if excludedBy(item, excludeLevels, excludeTags) {
			result.Excluded++
			result.ExcludedItemIDs = append(result.ExcludedItemIDs, item.ID)
			continue
		}
		stem := stemTerm(item.Term)
		families[stem] = append(families[stem], item)
	}

	stems := make([]string, 0, len(families))
	for stem := range families {
		stems = append(stems, stem)
	}
	sort.Strings(stems)
	now := time.Now().UTC()
	for _, stem := range stems {
		family := families[stem]
		if len(family) == 0 {
			continue
		}
		groupID := stableGroupID("word_family", stem)
		var created bool
		var linked int64
		err := p.store.WithTx(ctx, func(tx *db.TxStore) error {
			var txErr error
			created, txErr = tx.CreateKnowledgeGroupIfMissing(ctx, models.KnowledgeGroup{
				ID:        groupID,
				Name:      stem + " 词族",
				Kind:      "word_family",
				SortOrder: 0,
				CreatedAt: now,
				UpdatedAt: now,
			})
			if txErr != nil {
				return txErr
			}
			itemIDs := make([]string, 0, len(family))
			for _, item := range family {
				itemIDs = append(itemIDs, item.ID)
			}
			linked, txErr = tx.LinkKnowledgeItemsToGroup(ctx, itemIDs, groupID)
			return txErr
		})
		if err != nil {
			return result, err
		}
		if created {
			result.FamiliesCreated++
		}
		result.ItemsLinked += int(linked)
		result.Groups++
	}
	return result, nil
}

// GenerateWiki enriches each item with a detailed wiki from the provider.
// Items that cannot be generated are reported by ID and left unchanged.
func (p *Pipeline) GenerateWiki(ctx context.Context, itemIDs []string, provider agent.Provider) (WikiResult, error) {
	if provider == nil {
		return WikiResult{}, contextError("wiki provider is nil")
	}
	result := WikiResult{}
	for _, itemID := range itemIDs {
		item, err := p.store.GetKnowledgeItem(ctx, itemID)
		if err != nil {
			result.Failed = append(result.Failed, itemID)
			continue
		}
		response, err := provider.Generate(ctx, agent.Request{
			Kind: agent.KindWordWiki,
			WordWiki: &agent.WordWikiInput{
				ID:           item.ID,
				Term:         item.Term,
				PartOfSpeech: item.PartOfSpeech,
				Definition:   item.ConciseDefinition,
				Example:      item.Example,
				Level:        item.Level,
				Tags:         item.Tags,
			},
		})
		if err != nil || response.WordWiki == nil {
			result.Failed = append(result.Failed, itemID)
			continue
		}
		item.DetailedMarkdown = response.WordWiki.DetailedMarkdown
		if strings.TrimSpace(response.WordWiki.ConciseDefinition) != "" {
			item.ConciseDefinition = response.WordWiki.ConciseDefinition
		}
		item.UpdatedAt = time.Now().UTC()
		if err := p.store.UpdateKnowledgeItem(ctx, item); err != nil {
			result.Failed = append(result.Failed, itemID)
			continue
		}
		result.Generated++
	}
	return result, nil
}

func listAllItems(ctx context.Context, store *db.Store) ([]models.KnowledgeItem, error) {
	if store == nil {
		return nil, contextError("store is nil")
	}
	all := make([]models.KnowledgeItem, 0, 128)
	const pageSize = 500
	for offset := 0; ; offset += pageSize {
		items, err := store.ListKnowledgeItems(ctx, models.KnowledgeListOptions{Limit: pageSize, Offset: offset})
		if err != nil {
			return nil, err
		}
		all = append(all, items...)
		if len(items) < pageSize {
			return all, nil
		}
	}
}

func isWordItem(itemType string) bool {
	switch strings.ToLower(strings.TrimSpace(itemType)) {
	case "word_sense", "phrase", "collocation", "word_family", "root_affix":
		return true
	default:
		return false
	}
}

func excludedBy(item models.KnowledgeItem, levels, tags map[string]struct{}) bool {
	if _, hit := levels[strings.ToLower(strings.TrimSpace(item.Level))]; hit {
		return true
	}
	for _, tag := range item.Tags {
		if _, hit := tags[strings.ToLower(strings.TrimSpace(tag))]; hit {
			return true
		}
	}
	return false
}

func lowerSet(values []string) map[string]struct{} {
	result := make(map[string]struct{}, len(values))
	for _, value := range values {
		if normalized := strings.ToLower(strings.TrimSpace(value)); normalized != "" {
			result[normalized] = struct{}{}
		}
	}
	return result
}

func stemTerm(term string) string {
	value := strings.ToLower(strings.TrimSpace(term))
	if value == "" {
		return value
	}
	switch {
	case strings.HasSuffix(value, "ies") && len(value) > 4:
		return value[:len(value)-3] + "y"
	case strings.HasSuffix(value, "es") && len(value) > 3 && !strings.HasSuffix(value, "sses"):
		return value[:len(value)-2]
	case strings.HasSuffix(value, "s") && len(value) > 3 && !strings.HasSuffix(value, "ss"):
		return value[:len(value)-1]
	case strings.HasSuffix(value, "ing") && len(value) > 5:
		return value[:len(value)-3]
	case strings.HasSuffix(value, "ed") && len(value) > 4:
		return value[:len(value)-2]
	case strings.HasSuffix(value, "est") && len(value) > 5:
		return value[:len(value)-3]
	case strings.HasSuffix(value, "er") && len(value) > 4:
		return value[:len(value)-2]
	default:
		return value
	}
}

func stableGroupID(kind, name string) string {
	sum := sha256.Sum256([]byte(kind + "\x00" + name))
	return "group-" + hex.EncodeToString(sum[:6])
}

func contextError(message string) error {
	return &pipelineError{message: message}
}

type pipelineError struct{ message string }

func (e *pipelineError) Error() string { return e.message }
