package importer

import "testing"

func TestNormalizeCandidateProducesStableFingerprint(t *testing.T) {
	candidate := Candidate{
		ItemType:     " WORD_SENSE ",
		Term:         "  Abandon  ",
		PartOfSpeech: " V. ",
		Definition:   " 放弃；抛弃。 ",
		Tags:         []string{"CET4", " cet4 ", "core"},
	}

	normalized := NormalizeCandidate(candidate)

	if normalized.ItemType != "word_sense" {
		t.Fatalf("item type = %q", normalized.ItemType)
	}
	if normalized.Term != "abandon" {
		t.Fatalf("term = %q", normalized.Term)
	}
	if normalized.PartOfSpeech != "v" {
		t.Fatalf("part of speech = %q", normalized.PartOfSpeech)
	}
	if normalized.Definition != "放弃;抛弃" {
		t.Fatalf("definition = %q", normalized.Definition)
	}
	if got, want := normalized.Tags, []string{"cet4", "core"}; !equalStrings(got, want) {
		t.Fatalf("tags = %#v, want %#v", got, want)
	}
	if normalized.Fingerprint == "" {
		t.Fatal("fingerprint is empty")
	}
	if again := NormalizeCandidate(normalized); again.Fingerprint != normalized.Fingerprint {
		t.Fatalf("normalization is not stable: %q != %q", again.Fingerprint, normalized.Fingerprint)
	}
}

func TestClassifyDuplicate(t *testing.T) {
	tests := []struct {
		name     string
		existing Candidate
		incoming Candidate
		want     Disposition
	}{
		{
			name:     "exact duplicate",
			existing: Candidate{ItemType: "word_sense", Term: "abandon", PartOfSpeech: "v", Definition: "放弃;抛弃"},
			incoming: Candidate{ItemType: "WORD_SENSE", Term: " Abandon ", PartOfSpeech: "v.", Definition: "放弃；抛弃。"},
			want:     DispositionExact,
		},
		{
			name:     "near duplicate needs review",
			existing: Candidate{ItemType: "word_sense", Term: "abandon", PartOfSpeech: "v", Definition: "放弃;抛弃"},
			incoming: Candidate{ItemType: "word_sense", Term: "abandon", PartOfSpeech: "v", Definition: "放弃;舍弃"},
			want:     DispositionReview,
		},
		{
			name:     "different sense is new",
			existing: Candidate{ItemType: "word_sense", Term: "bank", PartOfSpeech: "n", Definition: "银行"},
			incoming: Candidate{ItemType: "word_sense", Term: "bank", PartOfSpeech: "n", Definition: "河岸"},
			want:     DispositionNewSense,
		},
		{
			name:     "new term is safe",
			existing: Candidate{ItemType: "word_sense", Term: "abandon", PartOfSpeech: "v", Definition: "放弃"},
			incoming: Candidate{ItemType: "word_sense", Term: "ability", PartOfSpeech: "n", Definition: "能力"},
			want:     DispositionInsert,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ClassifyDuplicate(tt.existing, tt.incoming); got != tt.want {
				t.Fatalf("ClassifyDuplicate() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestNormalizeCandidateNormalizesSubject(t *testing.T) {
	normalized := NormalizeCandidate(Candidate{
		ItemType:   "word_sense",
		Term:       "abandon",
		Definition: "放弃",
		Subject:    " English ",
	})
	if normalized.Subject != "english" {
		t.Fatalf("subject = %q, want english", normalized.Subject)
	}
}

func TestResolveDuplicatePrioritizesExactMatchOverEarlierReview(t *testing.T) {
	existing := []Candidate{
		{ItemType: "word_sense", Term: "bank", PartOfSpeech: "n", Definition: "financial institution"},
		{ItemType: "word_sense", Term: "bank", PartOfSpeech: "n", Definition: "financial institution; money bank"},
	}
	incoming := Candidate{ItemType: "word_sense", Term: "bank", PartOfSpeech: "n", Definition: "financial institution"}
	result := ResolveDuplicate(existing, incoming)
	if result.Disposition != DispositionExact {
		t.Fatalf("disposition = %q, want %q", result.Disposition, DispositionExact)
	}
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
