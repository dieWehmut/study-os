package audio

import (
	"context"
	"fmt"
)

// FallbackGenerator chains generators so a vendor outage degrades instead of
// failing outright. Configuring cloud TTS used to *replace* local speech, so a
// stalled or rejected DashScope took 朗读 down with it even though a working
// local voice was sitting right there. Only recoverable failures advance to the
// next step: an unsafe path or unsupported format is the caller's mistake, and
// retrying it would fail again while burying the real reason.
type FallbackGenerator struct {
	generators []Generator
}

var _ Generator = (*FallbackGenerator)(nil)
var _ TimelineGenerator = (*FallbackGenerator)(nil)

func NewFallbackGenerator(generators ...Generator) *FallbackGenerator {
	return &FallbackGenerator{generators: generators}
}

func (g *FallbackGenerator) Generate(ctx context.Context, request Request, destination string) error {
	_, err := g.GenerateWithTimeline(ctx, request, destination)
	return err
}

func (g *FallbackGenerator) GenerateWithTimeline(ctx context.Context, request Request, destination string) (Timeline, error) {
	var lastErr error
	for _, generator := range g.generators {
		if generator == nil {
			continue
		}
		timeline, err := generateOnce(ctx, generator, request, destination)
		if err == nil {
			return timeline, nil
		}
		lastErr = err
		// A cancelled caller is not a vendor outage: every later step would fail
		// the same way, so stop rather than burn the deadline twice.
		if ctx.Err() != nil || !IsRecoverable(err) {
			return Timeline{}, err
		}
	}
	if lastErr == nil {
		return Timeline{}, fmt.Errorf("%w: no audio generator is configured", ErrGeneratorUnavailable)
	}
	return Timeline{}, lastErr
}

// generateOnce runs a single generator, using its timeline capability when it
// has one. A plain Generator yields an empty timeline, which the service already
// reads as "no sidecar".
func generateOnce(ctx context.Context, generator Generator, request Request, destination string) (Timeline, error) {
	if timelineGenerator, ok := generator.(TimelineGenerator); ok {
		return timelineGenerator.GenerateWithTimeline(ctx, request, destination)
	}
	return Timeline{}, generator.Generate(ctx, request, destination)
}
