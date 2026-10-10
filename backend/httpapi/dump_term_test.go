package httpapi

import (
	"strings"
	"testing"
)

// A dumped note is named by its first line: that is the prompt, and everything
// under it is what the card asks for. Counting runes across the line break used
// to pull the start of the answer into the name, so the card asked its own answer.
func TestDumpTermStopsAtTheFirstLine(t *testing.T) {
	question := "导数到底描述什么？\n\n（离线模式）已收到你的问题：导数是变化率。"
	if term := dumpTerm(question); term != "导数到底描述什么？" {
		t.Fatalf("term = %q, want the first line alone", term)
	}

	// A one-line thought with no break keeps the old rule: 40 runes, then a cut.
	long := strings.Repeat("好", 60)
	if term := dumpTerm(long); len([]rune(term)) != 40 {
		t.Fatalf("term = %q (%d runes), want 40", term, len([]rune(term)))
	}

	// Blank first line: the first line is empty, so the name falls back rather
	// than becoming whitespace.
	if term := dumpTerm("\n正文在第二行。"); term != "未整理念头" {
		t.Fatalf("term = %q, want the fallback name", term)
	}
}
