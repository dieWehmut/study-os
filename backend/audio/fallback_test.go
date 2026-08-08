package audio

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

// stubGenerator either fails with a fixed error or writes fixed content.
type stubGenerator struct {
	err      error
	content  string
	timeline Timeline
	calls    int
}

func (g *stubGenerator) Generate(ctx context.Context, request Request, destination string) error {
	_, err := g.GenerateWithTimeline(ctx, request, destination)
	return err
}

func (g *stubGenerator) GenerateWithTimeline(_ context.Context, _ Request, destination string) (Timeline, error) {
	g.calls++
	if g.err != nil {
		return Timeline{}, g.err
	}
	if err := os.WriteFile(destination, []byte(g.content), 0o600); err != nil {
		return Timeline{}, err
	}
	return g.timeline, nil
}

// plainGenerator has no GenerateWithTimeline, so it exercises the branch where
// the chain has to fall back to the bare Generator interface -- which is what
// SAPI actually is.
type plainGenerator struct {
	content string
	calls   int
}

func (g *plainGenerator) Generate(_ context.Context, _ Request, destination string) error {
	g.calls++
	return os.WriteFile(destination, []byte(g.content), 0o600)
}

func TestFallbackGeneratorUsesLocalSpeechWhenTheCloudIsUnavailable(t *testing.T) {
	// The demo case: DashScope is configured, so it is the only generator the
	// service holds, and a stalled or rejected request kills 朗读 outright. A
	// recoverable cloud failure should hand off to local speech instead.
	cloud := &stubGenerator{err: fmt.Errorf("%w: synthesis request failed", ErrGeneratorUnavailable)}
	local := &plainGenerator{content: "sapi-audio"}

	chain := NewFallbackGenerator(cloud, local)
	destination := filepath.Join(t.TempDir(), "audio.wav")
	timeline, err := chain.GenerateWithTimeline(context.Background(), Request{Term: "abandon"}, destination)
	if err != nil {
		t.Fatalf("chain must recover through local speech: %v", err)
	}
	if cloud.calls != 1 || local.calls != 1 {
		t.Fatalf("calls: cloud = %d, local = %d, want 1 and 1", cloud.calls, local.calls)
	}
	got, err := os.ReadFile(destination)
	if err != nil {
		t.Fatalf("read generated audio: %v", err)
	}
	if string(got) != "sapi-audio" {
		t.Fatalf("audio = %q, want the local generator's output", string(got))
	}
	// SAPI produces no timing metadata, and the service already treats an empty
	// timeline as "no sidecar".
	if len(timeline.Segments) != 0 {
		t.Fatalf("timeline = %#v, want empty for local speech", timeline.Segments)
	}
}

func TestFallbackGeneratorKeepsTheCloudTimelineOnSuccess(t *testing.T) {
	cloud := &stubGenerator{content: "cloud-audio", timeline: Timeline{
		Segments: []Segment{{Start: 0, End: 800, Text: "abandon"}},
	}}
	local := &plainGenerator{content: "sapi-audio"}

	chain := NewFallbackGenerator(cloud, local)
	destination := filepath.Join(t.TempDir(), "audio.wav")
	timeline, err := chain.GenerateWithTimeline(context.Background(), Request{Term: "abandon"}, destination)
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	if local.calls != 0 {
		t.Fatal("a healthy cloud must not reach the local generator")
	}
	if len(timeline.Segments) != 1 || timeline.Segments[0].End != 800 {
		t.Fatalf("timeline = %#v, want the cloud's timing metadata", timeline.Segments)
	}
}

func TestFallbackGeneratorDoesNotRetryABadRequest(t *testing.T) {
	// An unsafe path or unsupported format is the caller's mistake, not a vendor
	// outage. Retrying it locally would just fail twice and bury the real reason.
	cloud := &stubGenerator{err: ErrUnsafePath}
	local := &plainGenerator{content: "sapi-audio"}

	chain := NewFallbackGenerator(cloud, local)
	err := chain.Generate(context.Background(), Request{Term: "abandon"},
		filepath.Join(t.TempDir(), "audio.wav"))
	if !errors.Is(err, ErrUnsafePath) {
		t.Fatalf("error = %v, want the original ErrUnsafePath", err)
	}
	if local.calls != 0 {
		t.Fatal("a non-recoverable failure must not fall through to local speech")
	}
}

func TestFallbackGeneratorReportsTheLastFailureWhenEveryStepFails(t *testing.T) {
	cloud := &stubGenerator{err: fmt.Errorf("%w: synthesis request failed", ErrGeneratorUnavailable)}
	local := &stubGenerator{err: fmt.Errorf("%w: Windows SAPI is available only on Windows", ErrGeneratorUnavailable)}

	chain := NewFallbackGenerator(cloud, local)
	err := chain.Generate(context.Background(), Request{Term: "abandon"},
		filepath.Join(t.TempDir(), "audio.wav"))
	if !errors.Is(err, ErrGeneratorUnavailable) {
		t.Fatalf("error = %v, want ErrGeneratorUnavailable", err)
	}
	if local.calls != 1 {
		t.Fatalf("local calls = %d, want 1", local.calls)
	}
}
