package models

import (
	"strings"
	"time"
)

type EnglishMasteryDimension string

const (
	EnglishMasteryRecognition   EnglishMasteryDimension = "recognition"
	EnglishMasteryComprehension EnglishMasteryDimension = "comprehension"
	EnglishMasteryRetrieval     EnglishMasteryDimension = "retrieval"
	EnglishMasteryUse           EnglishMasteryDimension = "use"
)

type MasteryState string

const (
	MasteryStateMissing      MasteryState = "missing"
	MasteryStateUntested     MasteryState = "untested"
	MasteryStateSelfReported MasteryState = "self_reported"
	MasteryStateNeedsWork    MasteryState = "needs_work"
	MasteryStatePartial      MasteryState = "partial"
	MasteryStateDemonstrated MasteryState = "demonstrated"
)

type MasteryEvidenceKind string

const (
	MasteryEvidenceNone       MasteryEvidenceKind = "none"
	MasteryEvidenceSelfReport MasteryEvidenceKind = "self_report"
	MasteryEvidenceAnswer     MasteryEvidenceKind = "answer"
)

// EnglishMasteryPromptSnapshot is the prompt-level source used to build the
// learner-facing projection. Persistence owns how the latest attempt is found.
type EnglishMasteryPromptSnapshot struct {
	PromptID                  string
	PromptType                string
	DueAt                     *time.Time
	AttemptCount              int
	LatestAnswer              string
	LatestEffectiveEvaluation string
	LastAttemptAt             *time.Time
}

type EnglishMasteryDimensionEvidence struct {
	Dimension     EnglishMasteryDimension `json:"dimension"`
	PromptTypes   []string                `json:"prompt_types"`
	State         MasteryState            `json:"state"`
	EvidenceKind  MasteryEvidenceKind     `json:"evidence_kind"`
	PromptCount   int                     `json:"prompt_count"`
	AttemptCount  int                     `json:"attempt_count"`
	LatestOutcome string                  `json:"latest_outcome,omitempty"`
	LastAttemptAt *time.Time              `json:"last_attempt_at,omitempty"`
	DueAt         *time.Time              `json:"due_at,omitempty"`
}

type EnglishMasteryProjection struct {
	KnowledgeItemID string                            `json:"knowledge_item_id"`
	Subject         string                            `json:"subject"`
	Dimensions      []EnglishMasteryDimensionEvidence `json:"dimensions"`
}

type englishMasteryDefinition struct {
	dimension  EnglishMasteryDimension
	promptType string
}

var englishMasteryDefinitions = []englishMasteryDefinition{
	{dimension: EnglishMasteryRecognition, promptType: "en_to_zh"},
	{dimension: EnglishMasteryComprehension, promptType: "context_cloze"},
	{dimension: EnglishMasteryRetrieval, promptType: "zh_to_en"},
	{dimension: EnglishMasteryUse, promptType: "make_sentence"},
}

func BuildEnglishMasteryProjection(knowledgeItemID, subject string, snapshots []EnglishMasteryPromptSnapshot) EnglishMasteryProjection {
	dimensions := make([]EnglishMasteryDimensionEvidence, len(englishMasteryDefinitions))
	byPromptType := make(map[string]int, len(englishMasteryDefinitions))
	for index, definition := range englishMasteryDefinitions {
		dimensions[index] = EnglishMasteryDimensionEvidence{
			Dimension:    definition.dimension,
			PromptTypes:  []string{definition.promptType},
			State:        MasteryStateMissing,
			EvidenceKind: MasteryEvidenceNone,
		}
		byPromptType[definition.promptType] = index
	}

	latestAnswers := make([]string, len(dimensions))
	latestPromptIDs := make([]string, len(dimensions))
	hasLatest := make([]bool, len(dimensions))
	for _, snapshot := range snapshots {
		index, ok := byPromptType[strings.ToLower(strings.TrimSpace(snapshot.PromptType))]
		if !ok {
			continue
		}
		evidence := &dimensions[index]
		evidence.PromptCount++
		if snapshot.AttemptCount > 0 {
			evidence.AttemptCount += snapshot.AttemptCount
		}
		if snapshot.DueAt != nil && (evidence.DueAt == nil || snapshot.DueAt.Before(*evidence.DueAt)) {
			dueAt := *snapshot.DueAt
			evidence.DueAt = &dueAt
		}
		if snapshot.AttemptCount <= 0 || !isLaterMasterySnapshot(snapshot, hasLatest[index], evidence.LastAttemptAt, latestPromptIDs[index]) {
			continue
		}
		hasLatest[index] = true
		latestAnswers[index] = snapshot.LatestAnswer
		latestPromptIDs[index] = snapshot.PromptID
		evidence.LatestOutcome = strings.ToLower(strings.TrimSpace(snapshot.LatestEffectiveEvaluation))
		if snapshot.LastAttemptAt != nil {
			lastAttemptAt := *snapshot.LastAttemptAt
			evidence.LastAttemptAt = &lastAttemptAt
		} else {
			evidence.LastAttemptAt = nil
		}
	}

	for index := range dimensions {
		evidence := &dimensions[index]
		switch {
		case evidence.PromptCount == 0:
			evidence.State = MasteryStateMissing
		case evidence.AttemptCount == 0 || !hasLatest[index]:
			evidence.State = MasteryStateUntested
		case evidence.Dimension == EnglishMasteryRecognition && strings.TrimSpace(latestAnswers[index]) == "":
			evidence.State = MasteryStateSelfReported
			evidence.EvidenceKind = MasteryEvidenceSelfReport
		default:
			evidence.EvidenceKind = MasteryEvidenceAnswer
			switch evidence.LatestOutcome {
			case "correct":
				evidence.State = MasteryStateDemonstrated
			case "partial":
				evidence.State = MasteryStatePartial
			default:
				evidence.State = MasteryStateNeedsWork
			}
		}
	}

	return EnglishMasteryProjection{
		KnowledgeItemID: knowledgeItemID,
		Subject:         strings.ToLower(strings.TrimSpace(subject)),
		Dimensions:      dimensions,
	}
}

func isLaterMasterySnapshot(snapshot EnglishMasteryPromptSnapshot, hasLatest bool, currentAt *time.Time, currentPromptID string) bool {
	if !hasLatest {
		return true
	}
	if snapshot.LastAttemptAt == nil {
		return currentAt == nil && snapshot.PromptID > currentPromptID
	}
	if currentAt == nil {
		return true
	}
	if snapshot.LastAttemptAt.Equal(*currentAt) {
		return snapshot.PromptID > currentPromptID
	}
	return snapshot.LastAttemptAt.After(*currentAt)
}
