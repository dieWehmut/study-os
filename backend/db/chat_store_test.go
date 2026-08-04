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

func TestChatMessagesPersistUpdateAndFilterBySubject(t *testing.T) {
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "study.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	now := time.Date(2026, 8, 4, 12, 0, 0, 0, time.UTC)
	messages := []models.ChatMessage{
		{ID: "user-1", SessionID: "default", Subject: "math", Role: "user", Content: "导数是什么", Status: "done", CreatedAt: now},
		{ID: "ai-1", SessionID: "default", Subject: "math", Role: "assistant", Status: "pending", CreatedAt: now.Add(time.Second)},
		{ID: "user-2", SessionID: "default", Subject: "english", Role: "user", Content: "abandon", Status: "done", CreatedAt: now.Add(2 * time.Second)},
	}
	for _, message := range messages {
		if err := store.CreateChatMessage(ctx, message); err != nil {
			t.Fatalf("create chat message: %v", err)
		}
	}
	if err := store.UpdateChatMessage(ctx, "ai-1", "导数是变化率", "done", ""); err != nil {
		t.Fatalf("update chat message: %v", err)
	}
	mathMessages, err := store.ListChatMessages(ctx, "math", "", 10)
	if err != nil {
		t.Fatalf("list math messages: %v", err)
	}
	if len(mathMessages) != 2 {
		t.Fatalf("math messages = %#v", mathMessages)
	}
	if mathMessages[1].Status != "done" || mathMessages[1].Content != "导数是变化率" {
		t.Fatalf("updated assistant message = %#v", mathMessages[1])
	}
}

func TestChatConversationsAndAttachments(t *testing.T) {
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "study.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	now := time.Date(2026, 8, 4, 12, 0, 0, 0, time.UTC)
	for _, message := range []models.ChatMessage{
		{ID: "u1", SessionID: "sess-a", Subject: "math", Role: "user", Content: "导数是啥？", Status: "done", CreatedAt: now},
		{ID: "a1", SessionID: "sess-a", Subject: "math", Role: "assistant", Content: "导数是变化率。", Status: "done", CreatedAt: now.Add(time.Second)},
		{ID: "u2", SessionID: "sess-b", Subject: "math", Role: "user", Content: "积分呢？", Status: "done", CreatedAt: now.Add(2 * time.Second)},
	} {
		if err := store.CreateChatMessage(ctx, message); err != nil {
			t.Fatalf("create message: %v", err)
		}
	}
	conversations, err := store.ListChatConversations(ctx, "math", 10)
	if err != nil {
		t.Fatalf("list conversations: %v", err)
	}
	if len(conversations) != 2 {
		t.Fatalf("conversations = %#v", conversations)
	}
	if conversations[0].SessionID != "sess-b" || conversations[0].Title != "积分呢？" || conversations[0].MessageCount != 1 {
		t.Fatalf("first conversation = %#v", conversations[0])
	}
	if conversations[1].MessageCount != 2 || conversations[1].Preview != "导数是变化率。" {
		t.Fatalf("second conversation = %#v", conversations[1])
	}

	attachment := models.ChatAttachment{
		ID: "att-1", SessionID: "sess-a", Subject: "math", MessageID: "u1",
		Name: "notes.txt", StoredPath: "tmp/notes.txt", SizeBytes: 12, Kind: "text", CreatedAt: now,
	}
	if err := store.CreateChatAttachment(ctx, attachment); err != nil {
		t.Fatalf("create attachment: %v", err)
	}
	got, err := store.GetChatAttachment(ctx, "att-1")
	if err != nil {
		t.Fatalf("get attachment: %v", err)
	}
	if got.Name != "notes.txt" || got.StoredPath != "tmp/notes.txt" || got.Kind != "text" {
		t.Fatalf("attachment = %#v", got)
	}
	if err := store.UpdateChatAttachment(ctx, "att-1", "sess-b", "physics", "u2"); err != nil {
		t.Fatalf("update attachment: %v", err)
	}
	updated, _ := store.GetChatAttachment(ctx, "att-1")
	if updated.SessionID != "sess-b" || updated.Subject != "physics" {
		t.Fatalf("updated attachment = %#v", updated)
	}
}

func TestKnowledgeTagFilterAndRecoveryMode(t *testing.T) {
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "study.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	now := time.Date(2026, 8, 4, 12, 0, 0, 0, time.UTC)
	item := models.KnowledgeItem{
		ID: "k-conclusion", ItemType: "theorem", Term: "动能定理", ConciseDefinition: "合外力做功等于动能变化", Subject: "physics",
		Tags: []string{"二级结论"}, CreatedAt: now, UpdatedAt: now,
	}
	other := models.KnowledgeItem{
		ID: "k-normal", ItemType: "concept", Term: "速度", ConciseDefinition: "位移变化率", Subject: "physics",
		CreatedAt: now, UpdatedAt: now,
	}
	if err := store.CreateKnowledgeItem(ctx, item); err != nil {
		t.Fatalf("create item: %v", err)
	}
	if err := store.CreateKnowledgeItem(ctx, other); err != nil {
		t.Fatalf("create item: %v", err)
	}
	filtered, err := store.ListKnowledgeItems(ctx, models.KnowledgeListOptions{Tag: "二级结论"})
	if err != nil {
		t.Fatalf("list by tag: %v", err)
	}
	if len(filtered) != 1 || filtered[0].ID != "k-conclusion" {
		t.Fatalf("tag filtered = %#v", filtered)
	}

	for index, prompt := range []models.Prompt{
		{ID: "p-easy", KnowledgeItemID: "k-conclusion", PromptType: "en_to_zh", Question: "q", CreatedAt: now, UpdatedAt: now},
		{ID: "p-hard", KnowledgeItemID: "k-conclusion", PromptType: "make_sentence", Question: "q2", CreatedAt: now.Add(time.Second), UpdatedAt: now.Add(time.Second)},
	} {
		if err := store.CreatePrompt(ctx, prompt); err != nil {
			t.Fatalf("create prompt: %v", err)
		}
		if err := store.UpsertReviewState(ctx, models.ReviewState{
			PromptID: prompt.ID, CardJSON: json.RawMessage(`{"due":"x"}`), DueAt: now.Add(time.Duration(index) * time.Second), UpdatedAt: now,
		}); err != nil {
			t.Fatalf("upsert state: %v", err)
		}
	}
	recovery, err := store.DuePromptsWithOptions(ctx, now.Add(time.Minute), db.DuePromptOptions{Mode: "recovery"})
	if err != nil {
		t.Fatalf("recovery due: %v", err)
	}
	if len(recovery) != 1 || recovery[0].ID != "p-easy" {
		t.Fatalf("recovery due = %#v", recovery)
	}
}
