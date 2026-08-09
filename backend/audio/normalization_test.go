package audio

import (
	"context"
	"os"
	"testing"
)

// termCapturingGenerator records the term it was asked to speak, which is the
// only way to observe what the voice would actually have received.
type termCapturingGenerator struct {
	terms []string
}

func (g *termCapturingGenerator) Generate(_ context.Context, request Request, destination string) error {
	g.terms = append(g.terms, request.Term)
	return os.WriteFile(destination, []byte("RIFFfake"), 0o600)
}

// The term used to be lowercased on its way to the generator, so the voice was
// asked to read "3.6 mj" when the note said "3.6 MJ" -- a millijoule instead of
// a megajoule. Case now survives to the generator while the cache stays
// case-insensitive, and this pins both halves of that split down.
func TestGeneratorReceivesTheTermWithItsCaseIntact(t *testing.T) {
	generator := &termCapturingGenerator{}
	service, err := NewService(t.TempDir(), WithGenerator(generator))
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	if _, err := service.Resolve(context.Background(), Request{Term: "Energy MJ and Cobalt Co"}); err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if len(generator.terms) != 1 {
		t.Fatalf("expected one synthesis, got %d", len(generator.terms))
	}
	if got := generator.terms[0]; got != "Energy MJ and Cobalt Co" {
		t.Errorf("generator saw %q, want the original capitalisation", got)
	}
}

func TestCacheKeyStaysCaseInsensitiveForTheTerm(t *testing.T) {
	upper := CacheKey(Request{Term: "Abandon", Locale: "en-US"})
	lower := CacheKey(Request{Term: "abandon", Locale: "en-US"})
	if upper != lower {
		t.Error("terms differing only in case should share one cache entry")
	}
}

// Two spellings of the same passage must not synthesise twice, and a passage
// whose spoken form differs must not collide. Because the key is derived from
// the normalized text, a symbol and its expansion are correctly treated as the
// same audio.
func TestCacheKeyFollowsTheSpokenFormNotTheWrittenOne(t *testing.T) {
	symbol := CacheKey(Request{Term: "x²"})
	spelled := CacheKey(Request{Term: "x的平方"})
	if symbol != spelled {
		t.Error("a symbol and its expansion produce the same audio and should share a key")
	}
	different := CacheKey(Request{Term: "x³"})
	if symbol == different {
		t.Error("different exponents must not share a cache entry")
	}
}

// The generator is handed normalized text, not the raw note, because that is
// the whole point of the package: the engine drops superscripts silently.
func TestGeneratorReceivesNormalizedNotation(t *testing.T) {
	generator := &termCapturingGenerator{}
	service, err := NewService(t.TempDir(), WithGenerator(generator))
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	if _, err := service.Resolve(context.Background(), Request{Term: "光速 3×10⁸"}); err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if got := generator.terms[0]; got != "光速 3乘以10的8次方" {
		t.Errorf("generator saw %q, want the expanded form", got)
	}
}
