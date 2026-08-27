package models

import (
	"testing"
	"time"
)

func TestBuildEnglishMasteryProjectionDistinguishesMissingUntestedAndLatestEvidence(t *testing.T) {
	now := time.Date(2026, 8, 24, 10, 0, 0, 0, time.UTC)
	due := now.Add(48 * time.Hour)
	projection := BuildEnglishMasteryProjection("sense-abandon", "english", []EnglishMasteryPromptSnapshot{
		{
			PromptID:                  "prompt-recognition",
			PromptType:                "en_to_zh",
			DueAt:                     &due,
			AttemptCount:              2,
			LatestAnswer:              "放弃",
			LatestEffectiveEvaluation: "correct",
			LastAttemptAt:             &now,
		},
		{
			PromptID:   "prompt-comprehension",
			PromptType: "context_cloze",
			DueAt:      &due,
		},
		{
			PromptID:                  "prompt-use",
			PromptType:                "make_sentence",
			DueAt:                     &due,
			AttemptCount:              1,
			LatestAnswer:              "They abandoned the plan.",
			LatestEffectiveEvaluation: "partial",
			LastAttemptAt:             &now,
		},
	})

	if projection.KnowledgeItemID != "sense-abandon" || projection.Subject != "english" {
		t.Fatalf("projection identity = %#v", projection)
	}
	if len(projection.Dimensions) != 4 {
		t.Fatalf("dimensions = %d, want 4", len(projection.Dimensions))
	}

	recognition := projection.Dimensions[0]
	if recognition.Dimension != EnglishMasteryRecognition || recognition.State != MasteryStateDemonstrated {
		t.Fatalf("recognition = %#v", recognition)
	}
	if recognition.EvidenceKind != MasteryEvidenceAnswer || recognition.AttemptCount != 2 || recognition.LatestOutcome != "correct" {
		t.Fatalf("recognition evidence = %#v", recognition)
	}

	comprehension := projection.Dimensions[1]
	if comprehension.Dimension != EnglishMasteryComprehension || comprehension.State != MasteryStateUntested {
		t.Fatalf("comprehension = %#v", comprehension)
	}
	if comprehension.PromptCount != 1 || comprehension.AttemptCount != 0 {
		t.Fatalf("comprehension counts = %#v", comprehension)
	}

	retrieval := projection.Dimensions[2]
	if retrieval.Dimension != EnglishMasteryRetrieval || retrieval.State != MasteryStateMissing {
		t.Fatalf("retrieval = %#v", retrieval)
	}
	if retrieval.PromptCount != 0 {
		t.Fatalf("retrieval prompt count = %d, want 0", retrieval.PromptCount)
	}

	usage := projection.Dimensions[3]
	if usage.Dimension != EnglishMasteryUse || usage.State != MasteryStatePartial {
		t.Fatalf("use = %#v", usage)
	}
}

func TestBuildEnglishMasteryProjectionKeepsLegacyRecognitionSelfRatingSeparate(t *testing.T) {
	now := time.Date(2026, 8, 24, 10, 0, 0, 0, time.UTC)
	projection := BuildEnglishMasteryProjection("sense-abandon", "english", []EnglishMasteryPromptSnapshot{
		{
			PromptID:                  "prompt-recognition",
			PromptType:                "en_to_zh",
			AttemptCount:              1,
			LatestEffectiveEvaluation: "correct",
			LastAttemptAt:             &now,
		},
	})

	recognition := projection.Dimensions[0]
	if recognition.State != MasteryStateSelfReported {
		t.Fatalf("recognition state = %q, want %q", recognition.State, MasteryStateSelfReported)
	}
	if recognition.EvidenceKind != MasteryEvidenceSelfReport {
		t.Fatalf("evidence kind = %q, want %q", recognition.EvidenceKind, MasteryEvidenceSelfReport)
	}
	if recognition.LatestOutcome != "correct" {
		t.Fatalf("latest outcome = %q, want correct", recognition.LatestOutcome)
	}
}
