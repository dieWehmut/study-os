package agent_test

import (
	"context"
	"strings"
	"testing"

	"study-os/backend/agent"
)

func TestMockChatAnswersDeterministically(t *testing.T) {
	provider := agent.NewMockProvider()
	output, err := provider.Generate(context.Background(), agent.Request{
		Kind: agent.KindChat,
		Chat: &agent.ChatInput{Subject: "math", Prompt: "导数是什么？"},
	})
	if err != nil {
		t.Fatalf("chat: %v", err)
	}
	if output.Chat == nil || !strings.Contains(output.Chat.Answer, "导数是什么？") || !strings.Contains(output.Chat.Answer, "数学") {
		t.Fatalf("chat output = %#v", output.Chat)
	}
}

func TestMockCompareIncludesBothTerms(t *testing.T) {
	provider := agent.NewMockProvider()
	output, err := provider.Generate(context.Background(), agent.Request{
		Kind:    agent.KindCompare,
		Compare: &agent.CompareInput{Subject: "physics", TermA: "速度", TermB: "加速度"},
	})
	if err != nil {
		t.Fatalf("compare: %v", err)
	}
	if output.Compare == nil || !strings.Contains(output.Compare.Summary, "速度") || !strings.Contains(output.Compare.Summary, "加速度") {
		t.Fatalf("compare output = %#v", output.Compare)
	}
	if len(output.Compare.DiffPoints) != 2 {
		t.Fatalf("diff points = %#v", output.Compare.DiffPoints)
	}
}

func TestValidateRequiresChatAndCompareInputs(t *testing.T) {
	provider := agent.NewMockProvider()
	for _, request := range []agent.Request{
		{Kind: agent.KindChat},
		{Kind: agent.KindCompare},
	} {
		if _, err := provider.Generate(context.Background(), request); err == nil {
			t.Fatalf("kind %q without input succeeded", request.Kind)
		}
	}
}

func TestMockIntegrateBuildsMindmapAndCards(t *testing.T) {
	provider := agent.NewMockProvider()
	output, err := provider.Generate(context.Background(), agent.Request{
		Kind: agent.KindIntegrate,
		Integrate: &agent.IntegrateInput{
			Subject:  "physics",
			Title:    "运动学",
			Text:     "速度描述运动的快慢。加速度描述速度变化的快慢。匀变速运动中，加速度恒定。",
			MaxCards: 3,
		},
	})
	if err != nil {
		t.Fatalf("integrate: %v", err)
	}
	if output.Integrate == nil {
		t.Fatalf("integrate output = %#v", output)
	}
	if output.Integrate.Map.Title != "运动学" || len(output.Integrate.Map.Nodes) < 4 {
		t.Fatalf("mindmap = %#v", output.Integrate.Map)
	}
	if output.Integrate.Map.Nodes[0].NodeType != "root" || output.Integrate.Map.Nodes[1].ParentID != "n0" {
		t.Fatalf("nodes = %#v", output.Integrate.Map.Nodes)
	}
	if len(output.Integrate.Cards) == 0 || output.Integrate.Cards[0].CardType != "concept" {
		t.Fatalf("cards = %#v", output.Integrate.Cards)
	}
}
