package db_test

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"study-os/backend/db"
	"study-os/backend/models"
)

// 归档 hides an item from the default view and deletes nothing (ROADMAP §8.1).
//
// The three things this pins down are the three that could each be got wrong on their
// own: the default list drops it, an explicit ask gets it back, and the single-item read
// still finds it -- because "I do not want to see this in the library" is not "this
// never existed", and a deep link to it has to keep working.
func TestArchivingHidesAnItemWithoutDeletingIt(t *testing.T) {
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "study.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	now := time.Date(2026, 8, 22, 9, 0, 0, 0, time.UTC)
	item := models.KnowledgeItem{
		ID: "k-archive", ItemType: "word_sense", Term: "archive", ConciseDefinition: "归档",
		CreatedAt: now, UpdatedAt: now,
	}
	if err := store.CreateKnowledgeItem(ctx, item); err != nil {
		t.Fatalf("create item: %v", err)
	}

	visible, err := store.CountKnowledgeItems(ctx, models.KnowledgeListOptions{})
	if err != nil {
		t.Fatalf("count before: %v", err)
	}
	if visible != 1 {
		t.Fatalf("count before archiving = %d, want 1", visible)
	}

	if err := store.SetKnowledgeArchived(ctx, item.ID, true); err != nil {
		t.Fatalf("archive: %v", err)
	}

	// ① The default view hides it...
	hidden, err := store.CountKnowledgeItems(ctx, models.KnowledgeListOptions{})
	if err != nil {
		t.Fatalf("count after: %v", err)
	}
	if hidden != 0 {
		t.Fatalf("count after archiving = %d, want 0", hidden)
	}
	// ...while an explicit ask still finds it.
	withArchived, err := store.CountKnowledgeItems(ctx, models.KnowledgeListOptions{IncludeArchived: true})
	if err != nil {
		t.Fatalf("count with archived: %v", err)
	}
	if withArchived != 1 {
		t.Fatalf("count including archived = %d, want 1", withArchived)
	}

	// ② The single-item read is not filtered: a deep link still opens it, and the row
	// is still there -- nothing was deleted.
	found, err := store.GetKnowledgeItem(ctx, item.ID)
	if err != nil {
		t.Fatalf("deep link to an archived item: %v", err)
	}
	if found.ID != item.ID {
		t.Fatalf("deep link returned %q", found.ID)
	}

	// ③ 取消归档 puts it back exactly as it was.
	if err := store.SetKnowledgeArchived(ctx, item.ID, false); err != nil {
		t.Fatalf("unarchive: %v", err)
	}
	restored, err := store.CountKnowledgeItems(ctx, models.KnowledgeListOptions{})
	if err != nil {
		t.Fatalf("count after unarchiving: %v", err)
	}
	if restored != 1 {
		t.Fatalf("count after unarchiving = %d, want 1", restored)
	}

	// Archiving something that is not there is a missing record, not a silent success.
	if err := store.SetKnowledgeArchived(ctx, "nope", true); !errors.Is(err, db.ErrNotFound) {
		t.Fatalf("archiving a missing item = %v, want ErrNotFound", err)
	}
}
