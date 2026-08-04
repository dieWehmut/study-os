package db_test

import (
	"context"
	"encoding/json"
	"path/filepath"
	"testing"
	"time"

	"study-os/backend/db"
	"study-os/backend/models"
)

func TestIntegratedNotesPersistAndListBySubject(t *testing.T) {
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "study.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	now := time.Date(2026, 8, 4, 12, 0, 0, 0, time.UTC)
	note := models.IntegratedNote{
		ID: "note-1", Subject: "physics", Title: "运动学", SourceType: "knowledge_item", SourceID: "k1",
		MindmapJSON: json.RawMessage(`{"title":"运动学","nodes":[{"id":"n0","label":"运动学","node_type":"root"}]}`),
		CardsJSON:   json.RawMessage(`[{"id":"c1","card_type":"concept","title":"速度","body":"描述快慢"}]`),
		CreatedAt:   now,
	}
	if err := store.CreateIntegratedNote(ctx, note); err != nil {
		t.Fatalf("create note: %v", err)
	}
	got, err := store.GetIntegratedNote(ctx, "note-1")
	if err != nil {
		t.Fatalf("get note: %v", err)
	}
	if got.Title != "运动学" || string(got.MindmapJSON) != string(note.MindmapJSON) {
		t.Fatalf("note = %#v", got)
	}
	notes, err := store.ListIntegratedNotes(ctx, "physics", 10)
	if err != nil {
		t.Fatalf("list notes: %v", err)
	}
	if len(notes) != 1 || notes[0].ID != "note-1" {
		t.Fatalf("notes = %#v", notes)
	}
}
