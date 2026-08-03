package db

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"study-os/backend/models"
)

func (s *Store) CreateKnowledgeGroup(ctx context.Context, group models.KnowledgeGroup) error {
	return createKnowledgeGroup(ctx, s.db, group)
}

func (s *TxStore) CreateKnowledgeGroup(ctx context.Context, group models.KnowledgeGroup) error {
	return createKnowledgeGroup(ctx, s.tx, group)
}

func createKnowledgeGroup(ctx context.Context, database queryer, group models.KnowledgeGroup) error {
	createdAt, updatedAt := normalizedTimes(group.CreatedAt, group.UpdatedAt)
	var parentID any
	if group.ParentID != "" {
		parentID = group.ParentID
	}
	_, err := database.ExecContext(ctx, `
		INSERT INTO knowledge_groups(id, name, kind, parent_id, sort_order, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)`,
		group.ID, group.Name, group.Kind, parentID, group.SortOrder,
		formatTime(createdAt), formatTime(updatedAt))
	return err
}

func (s *Store) ListKnowledgeGroups(ctx context.Context) ([]models.KnowledgeGroup, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, name, kind, COALESCE(parent_id, ''), sort_order, created_at, updated_at
		FROM knowledge_groups
		ORDER BY sort_order ASC, name ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	groups := make([]models.KnowledgeGroup, 0)
	for rows.Next() {
		group, err := scanKnowledgeGroup(rows)
		if err != nil {
			return nil, err
		}
		groups = append(groups, group)
	}
	return groups, rows.Err()
}

func (s *Store) ListGroupsForItem(ctx context.Context, itemID string) ([]models.KnowledgeGroup, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT g.id, g.name, g.kind, COALESCE(g.parent_id, ''), g.sort_order, g.created_at, g.updated_at
		FROM knowledge_groups AS g
		JOIN knowledge_item_groups AS ig ON ig.group_id = g.id
		WHERE ig.knowledge_item_id = ?
		ORDER BY g.sort_order ASC, g.name ASC`, itemID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	groups := make([]models.KnowledgeGroup, 0)
	for rows.Next() {
		group, err := scanKnowledgeGroup(rows)
		if err != nil {
			return nil, err
		}
		groups = append(groups, group)
	}
	return groups, rows.Err()
}

func (s *TxStore) LinkKnowledgeItemToGroup(ctx context.Context, itemID, groupID string) error {
	_, err := s.tx.ExecContext(ctx, `
		INSERT OR IGNORE INTO knowledge_item_groups(knowledge_item_id, group_id)
		VALUES (?, ?)`, itemID, groupID)
	return err
}

func (s *TxStore) CreateKnowledgeGroupIfMissing(ctx context.Context, group models.KnowledgeGroup) (bool, error) {
	createdAt, updatedAt := normalizedTimes(group.CreatedAt, group.UpdatedAt)
	result, err := s.tx.ExecContext(ctx, `
		INSERT OR IGNORE INTO knowledge_groups(id, name, kind, parent_id, sort_order, created_at, updated_at)
		VALUES (?, ?, ?, NULLIF(?, ''), ?, ?, ?)`,
		group.ID, group.Name, group.Kind, group.ParentID, group.SortOrder,
		formatTime(createdAt), formatTime(updatedAt))
	if err != nil {
		return false, err
	}
	changed, err := result.RowsAffected()
	return changed > 0, err
}

func (s *TxStore) LinkKnowledgeItemsToGroup(ctx context.Context, itemIDs []string, groupID string) (int64, error) {
	var linked int64
	for _, itemID := range itemIDs {
		result, err := s.tx.ExecContext(ctx, `
			INSERT OR IGNORE INTO knowledge_item_groups(knowledge_item_id, group_id)
			VALUES (?, ?)`, itemID, groupID)
		if err != nil {
			return linked, err
		}
		changed, err := result.RowsAffected()
		if err != nil {
			return linked, err
		}
		linked += changed
	}
	return linked, nil
}

func (s *Store) ListItemsByGroup(ctx context.Context, groupID string, limit, offset int) ([]models.KnowledgeItem, error) {
	rows, err := s.db.QueryContext(ctx, `
		`+knowledgeSelect+`
		JOIN knowledge_item_groups AS ig ON ig.knowledge_item_id = knowledge_items.id
		WHERE ig.group_id = ?
		ORDER BY knowledge_items.term ASC
		LIMIT ? OFFSET ?`, groupID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]models.KnowledgeItem, 0)
	for rows.Next() {
		item, err := scanKnowledgeItem(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

// ListDistractorTerms returns distinct word-like terms usable as wrong options
// for a cloze/guessing prompt, excluding the current item.
func (s *Store) ListDistractorTerms(ctx context.Context, excludeID string, limit int) ([]string, error) {
	if limit <= 0 || limit > 100 {
		limit = 10
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT DISTINCT term FROM knowledge_items
		WHERE id != ? AND item_type IN ('word_sense', 'phrase', 'collocation')
		ORDER BY term ASC
		LIMIT ?`, excludeID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	terms := make([]string, 0, limit)
	for rows.Next() {
		var term string
		if err := rows.Scan(&term); err != nil {
			return nil, err
		}
		terms = append(terms, term)
	}
	return terms, rows.Err()
}

func (s *Store) UpsertAudioAsset(ctx context.Context, asset models.AudioAsset) error {
	createdAt := asset.CreatedAt
	if createdAt.IsZero() {
		createdAt = nowUTC()
	}
	timeline := asset.TimelineJSON
	if len(timeline) == 0 {
		timeline = json.RawMessage(`{}`)
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO audio_assets(id, knowledge_item_id, source_type, uri, attribution, provider, voice, timeline_json, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			knowledge_item_id = excluded.knowledge_item_id,
			source_type = excluded.source_type,
			uri = excluded.uri,
			attribution = excluded.attribution,
			provider = excluded.provider,
			voice = excluded.voice,
			timeline_json = excluded.timeline_json`,
		asset.ID, asset.KnowledgeItemID, asset.SourceType, asset.URI, asset.Attribution,
		asset.Provider, asset.Voice, string(timeline), formatTime(createdAt))
	return err
}

func (s *Store) ListAudioAssets(ctx context.Context, itemID string) ([]models.AudioAsset, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, knowledge_item_id, source_type, uri, attribution, provider, voice, timeline_json, created_at
		FROM audio_assets
		WHERE knowledge_item_id = ?
		ORDER BY created_at DESC`, itemID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	assets := make([]models.AudioAsset, 0)
	for rows.Next() {
		asset, err := scanAudioAsset(rows)
		if err != nil {
			return nil, err
		}
		assets = append(assets, asset)
	}
	return assets, rows.Err()
}

func scanKnowledgeGroup(row scanner) (models.KnowledgeGroup, error) {
	var group models.KnowledgeGroup
	var createdAt, updatedAt string
	if err := row.Scan(&group.ID, &group.Name, &group.Kind, &group.ParentID,
		&group.SortOrder, &createdAt, &updatedAt); err != nil {
		return models.KnowledgeGroup{}, err
	}
	var err error
	if group.CreatedAt, err = parseTime(createdAt); err != nil {
		return models.KnowledgeGroup{}, fmt.Errorf("parse group created time: %w", err)
	}
	if group.UpdatedAt, err = parseTime(updatedAt); err != nil {
		return models.KnowledgeGroup{}, fmt.Errorf("parse group updated time: %w", err)
	}
	return group, nil
}

func scanAudioAsset(row scanner) (models.AudioAsset, error) {
	var asset models.AudioAsset
	var timeline, createdAt string
	if err := row.Scan(&asset.ID, &asset.KnowledgeItemID, &asset.SourceType, &asset.URI,
		&asset.Attribution, &asset.Provider, &asset.Voice, &timeline, &createdAt); err != nil {
		return models.AudioAsset{}, err
	}
	asset.TimelineJSON = json.RawMessage(timeline)
	var err error
	if asset.CreatedAt, err = parseTime(createdAt); err != nil {
		return models.AudioAsset{}, fmt.Errorf("parse audio asset created time: %w", err)
	}
	return asset, nil
}

func nowUTC() time.Time {
	return time.Now().UTC()
}
