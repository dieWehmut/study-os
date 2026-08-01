package importer

import (
	"crypto/sha256"
	"encoding/hex"
	"sort"
	"strings"
	"unicode"
)

// Candidate is the subject-neutral shape produced by an import mapper.
// RawJSON is intentionally retained so an imported row can always be traced back.
type Candidate struct {
	KnowledgeItemID string   `json:"-"`
	ItemType        string   `json:"item_type"`
	Term            string   `json:"term"`
	PartOfSpeech    string   `json:"part_of_speech,omitempty"`
	Pronunciation   string   `json:"pronunciation,omitempty"`
	Definition      string   `json:"definition"`
	Example         string   `json:"example,omitempty"`
	Wiki            string   `json:"wiki,omitempty"`
	Level           string   `json:"level,omitempty"`
	Tags            []string `json:"tags,omitempty"`
	RawJSON         string   `json:"-"`
	Fingerprint     string   `json:"fingerprint"`
}

type Disposition string

const (
	DispositionInsert   Disposition = "insert"
	DispositionExact    Disposition = "exact_duplicate"
	DispositionReview   Disposition = "review"
	DispositionNewSense Disposition = "new_sense"
)

func NormalizeCandidate(candidate Candidate) Candidate {
	candidate.ItemType = normalizeToken(candidate.ItemType)
	candidate.Term = normalizeTerm(candidate.Term)
	candidate.PartOfSpeech = normalizePartOfSpeech(candidate.PartOfSpeech)
	candidate.Pronunciation = normalizeText(candidate.Pronunciation)
	candidate.Definition = normalizeDefinition(candidate.Definition)
	candidate.Example = normalizeText(candidate.Example)
	candidate.Wiki = strings.TrimSpace(candidate.Wiki)
	candidate.Level = normalizeToken(candidate.Level)
	candidate.Tags = normalizeTags(candidate.Tags)

	hash := sha256.New()
	for _, value := range []string{candidate.ItemType, candidate.Term, candidate.PartOfSpeech, candidate.Definition} {
		hash.Write([]byte(value))
		hash.Write([]byte{0})
	}
	candidate.Fingerprint = hex.EncodeToString(hash.Sum(nil))
	return candidate
}

func ClassifyDuplicate(existing, incoming Candidate) Disposition {
	left := NormalizeCandidate(existing)
	right := NormalizeCandidate(incoming)
	if left.Fingerprint == right.Fingerprint {
		return DispositionExact
	}
	if left.Term != right.Term || left.PartOfSpeech != right.PartOfSpeech || left.ItemType != right.ItemType {
		return DispositionInsert
	}
	if definitionSimilarity(left.Definition, right.Definition) >= 0.45 {
		return DispositionReview
	}
	return DispositionNewSense
}

func normalizeToken(value string) string {
	return strings.ToLower(strings.Join(strings.Fields(strings.TrimSpace(value)), "_"))
}

func normalizeTerm(value string) string {
	value = normalizeText(value)
	value = strings.Trim(value, " \t\r\n.,!?;:()[]{}\"'")
	return strings.ToLower(value)
}

func normalizePartOfSpeech(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	value = strings.Trim(value, ".")
	return value
}

func normalizeDefinition(value string) string {
	value = normalizeText(value)
	value = strings.Trim(value, " ;,，；。.!！?？")
	value = strings.NewReplacer("；", ";", "，", ",", "。", "", "！", "!", "？", "?").Replace(value)
	value = strings.Join(strings.Fields(value), " ")
	return value
}

func normalizeText(value string) string {
	value = strings.TrimSpace(value)
	value = strings.Map(func(r rune) rune {
		if unicode.IsSpace(r) {
			return ' '
		}
		return r
	}, value)
	return strings.Join(strings.Fields(value), " ")
}

func normalizeTags(tags []string) []string {
	seen := make(map[string]struct{}, len(tags))
	result := make([]string, 0, len(tags))
	for _, tag := range tags {
		normalized := normalizeToken(tag)
		if normalized == "" {
			continue
		}
		if _, exists := seen[normalized]; exists {
			continue
		}
		seen[normalized] = struct{}{}
		result = append(result, normalized)
	}
	sort.Strings(result)
	return result
}

func definitionSimilarity(left, right string) float64 {
	if !strings.ContainsAny(left+right, " \t") {
		return runeSetSimilarity([]rune(left), []rune(right))
	}
	leftTokens := tokenSet(left)
	rightTokens := tokenSet(right)
	if len(leftTokens) == 0 || len(rightTokens) == 0 {
		return 0
	}
	intersection := 0
	for token := range leftTokens {
		if _, ok := rightTokens[token]; ok {
			intersection++
		}
	}
	union := len(leftTokens) + len(rightTokens) - intersection
	if union == 0 {
		return 0
	}
	return float64(intersection) / float64(union)
}

func runeSetSimilarity(left, right []rune) float64 {
	leftSet := make(map[rune]struct{}, len(left))
	rightSet := make(map[rune]struct{}, len(right))
	for _, r := range left {
		leftSet[r] = struct{}{}
	}
	for _, r := range right {
		rightSet[r] = struct{}{}
	}
	if len(leftSet) == 0 || len(rightSet) == 0 {
		return 0
	}
	intersection := 0
	for r := range leftSet {
		if _, ok := rightSet[r]; ok {
			intersection++
		}
	}
	union := len(leftSet) + len(rightSet) - intersection
	return float64(intersection) / float64(union)
}

func tokenSet(value string) map[string]struct{} {
	result := make(map[string]struct{})
	for _, token := range strings.Fields(strings.ToLower(value)) {
		result[token] = struct{}{}
	}
	return result
}
