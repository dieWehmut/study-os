package db_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"path/filepath"
	"testing"
	"time"

	"study-os/backend/db"
	"study-os/backend/models"

	_ "modernc.org/sqlite"
)

func TestKnowledgeGroupsPersistAndLinkItemsAcrossReopen(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "study.db")
	now := time.Date(2026, 8, 3, 10, 0, 0, 0, time.UTC)

	store, err := db.Open(ctx, path)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	group := models.KnowledgeGroup{
		ID:        "group-abandon",
		Name:      "abandon 词族",
		Kind:      "word_family",
		SortOrder: 1,
		CreatedAt: now,
		UpdatedAt: now,
	}
	if err := store.CreateKnowledgeGroup(ctx, group); err != nil {
		t.Fatalf("create group: %v", err)
	}
	item := models.KnowledgeItem{
		ID:                "knowledge-1",
		ItemType:          "word_sense",
		Term:              "abandon",
		ConciseDefinition: "放弃；抛弃",
		CreatedAt:         now,
		UpdatedAt:         now,
	}
	if err := store.CreateKnowledgeItem(ctx, item); err != nil {
		t.Fatalf("create knowledge item: %v", err)
	}
	if err := store.WithTx(ctx, func(tx *db.TxStore) error {
		return tx.LinkKnowledgeItemToGroup(ctx, item.ID, group.ID)
	}); err != nil {
		t.Fatalf("link item to group: %v", err)
	}
	if err := store.Close(); err != nil {
		t.Fatalf("close store: %v", err)
	}

	reopened, err := db.Open(ctx, path)
	if err != nil {
		t.Fatalf("reopen store: %v", err)
	}
	t.Cleanup(func() { _ = reopened.Close() })

	groups, err := reopened.ListKnowledgeGroups(ctx)
	if err != nil {
		t.Fatalf("list groups: %v", err)
	}
	if len(groups) != 1 || groups[0].ID != group.ID || groups[0].Name != group.Name {
		t.Fatalf("groups = %#v", groups)
	}
	itemGroups, err := reopened.ListGroupsForItem(ctx, item.ID)
	if err != nil {
		t.Fatalf("list item groups: %v", err)
	}
	if len(itemGroups) != 1 || itemGroups[0].ID != group.ID {
		t.Fatalf("item groups = %#v", itemGroups)
	}
	items, err := reopened.ListItemsByGroup(ctx, group.ID, 10, 0)
	if err != nil {
		t.Fatalf("list items by group: %v", err)
	}
	if len(items) != 1 || items[0].ID != item.ID {
		t.Fatalf("group items = %#v", items)
	}
}

func TestAudioAssetsUpsertAndList(t *testing.T) {
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "study.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	now := time.Date(2026, 8, 3, 10, 0, 0, 0, time.UTC)
	item := models.KnowledgeItem{
		ID:                "knowledge-audio",
		ItemType:          "word_sense",
		Term:              "abandon",
		ConciseDefinition: "放弃",
		CreatedAt:         now,
		UpdatedAt:         now,
	}
	if err := store.CreateKnowledgeItem(ctx, item); err != nil {
		t.Fatalf("create knowledge item: %v", err)
	}
	asset := models.AudioAsset{
		ID:              "audio-1",
		KnowledgeItemID: item.ID,
		SourceType:      "dashscope",
		URI:             "audio/abandon.wav",
		Provider:        "dashscope",
		Voice:           "longxiaochun",
		TimelineJSON:    json.RawMessage(`[{"start":0,"end":800,"text":"abandon"}]`),
		CreatedAt:       now,
	}
	if err := store.UpsertAudioAsset(ctx, asset); err != nil {
		t.Fatalf("upsert audio asset: %v", err)
	}
	asset.Voice = "longhua"
	if err := store.UpsertAudioAsset(ctx, asset); err != nil {
		t.Fatalf("re-upsert audio asset: %v", err)
	}
	assets, err := store.ListAudioAssets(ctx, item.ID)
	if err != nil {
		t.Fatalf("list audio assets: %v", err)
	}
	if len(assets) != 1 || assets[0].Voice != "longhua" || assets[0].Provider != "dashscope" {
		t.Fatalf("audio assets = %#v", assets)
	}
	if string(assets[0].TimelineJSON) != string(asset.TimelineJSON) {
		t.Fatalf("timeline = %s", string(assets[0].TimelineJSON))
	}
}

func TestStoreUpgradesSchemaVersionTwoWithGroupsAndAudioColumns(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "legacy-v2.db")
	legacy, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("open legacy sqlite: %v", err)
	}
	_, err = legacy.ExecContext(ctx, `
		CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
		INSERT INTO schema_migrations(version, applied_at) VALUES (2, '2026-08-01T00:00:00Z');
		CREATE TABLE import_jobs (
			id TEXT PRIMARY KEY,
			source_id TEXT,
			staged_path TEXT NOT NULL,
			original_name TEXT NOT NULL DEFAULT '',
			selected_table TEXT NOT NULL DEFAULT '',
			mapping_json TEXT NOT NULL DEFAULT '{}',
			state TEXT NOT NULL,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		);
		CREATE TABLE audio_assets (
			id TEXT PRIMARY KEY,
			knowledge_item_id TEXT,
			source_type TEXT NOT NULL,
			uri TEXT NOT NULL,
			attribution TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL
		);`)
	if err != nil {
		_ = legacy.Close()
		t.Fatalf("create legacy schema: %v", err)
	}
	if err := legacy.Close(); err != nil {
		t.Fatalf("close legacy sqlite: %v", err)
	}

	store, err := db.Open(ctx, path)
	if err != nil {
		t.Fatalf("upgrade legacy store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	var versions []int
	rows, err := store.SQL().QueryContext(ctx, `SELECT version FROM schema_migrations ORDER BY version`)
	if err != nil {
		t.Fatalf("list migrations: %v", err)
	}
	for rows.Next() {
		var version int
		if err := rows.Scan(&version); err != nil {
			t.Fatalf("scan migration: %v", err)
		}
		versions = append(versions, version)
	}
	rows.Close()
	if len(versions) != 2 || versions[0] != 2 || versions[1] != 3 {
		t.Fatalf("migration versions = %#v, want [2 3]", versions)
	}

	var groupTables int
	if err := store.SQL().QueryRowContext(ctx, `
		SELECT COUNT(*) FROM sqlite_master
		WHERE type = 'table' AND name IN ('knowledge_groups', 'knowledge_item_groups')`).Scan(&groupTables); err != nil {
		t.Fatalf("inspect group tables: %v", err)
	}
	if groupTables != 2 {
		t.Fatalf("group tables = %d, want 2", groupTables)
	}
	var audioColumns int
	if err := store.SQL().QueryRowContext(ctx, `
		SELECT COUNT(*) FROM pragma_table_info('audio_assets')
		WHERE name IN ('provider', 'voice', 'timeline_json')`).Scan(&audioColumns); err != nil {
		t.Fatalf("inspect audio columns: %v", err)
	}
	if audioColumns != 3 {
		t.Fatalf("audio columns = %d, want 3", audioColumns)
	}
}
