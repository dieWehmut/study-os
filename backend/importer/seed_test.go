package importer

import (
	"context"
	"encoding/csv"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"study-os/backend/db"
	"study-os/backend/memory"
)

// seedPath is the shipped 高考 core vocabulary list. It is imported through the
// same wizard as any user file, so it has to satisfy the same contract.
const seedPath = "../../seed/english-gaokao-core.csv"

// The seed list is the first thing a new user imports, so a broken row would be
// the first thing they see. These tests pin the contract the import pipeline
// silently depends on: headers that auto-map, rows that survive normalization,
// and examples that actually produce a cloze instead of the generic fallback.
func TestSeedVocabularyImportsCleanly(t *testing.T) {
	rows, header := readSeed(t)

	mapping := Mapping{
		Term:          "term",
		Definition:    "definition",
		PartOfSpeech:  "part_of_speech",
		Pronunciation: "pronunciation",
		Example:       "example",
		Level:         "level",
		Subject:       "subject",
		Tags:          "tags",
	}
	if err := validateMapping(mapping, header); err != nil {
		t.Fatalf("seed header does not satisfy the wizard mapping: %v", err)
	}

	accepted := make([]Candidate, 0, len(rows))
	for index, row := range rows {
		candidate, err := mapCandidate(row, mapping, nil)
		if err != nil {
			t.Fatalf("row %d (%v) is not importable: %v", index+2, row["term"], err)
		}
		result := ResolveDuplicate(accepted, candidate)
		if result.Disposition != DispositionInsert {
			t.Fatalf("row %d (%v) collides with an earlier row: %s", index+2, row["term"], result.Disposition)
		}
		accepted = append(accepted, result.Incoming)
	}

	if len(accepted) < 100 {
		t.Fatalf("seed list has only %d rows, expected at least 100", len(accepted))
	}
}

func TestSeedVocabularyGeneratesUsablePrompts(t *testing.T) {
	rows, _ := readSeed(t)

	for index, row := range rows {
		candidate := NormalizeCandidate(Candidate{
			ItemType:   "word_sense",
			Term:       valueString(row["term"]),
			Definition: valueString(row["definition"]),
			Example:    valueString(row["example"]),
			Subject:    valueString(row["subject"]),
		})
		prompts := memory.GeneratePrompts(memory.KnowledgeItem{
			ID:                "seed",
			ItemType:          candidate.ItemType,
			Subject:           candidate.Subject,
			Term:              candidate.Term,
			ConciseDefinition: candidate.Definition,
			Example:           candidate.Example,
			AcceptedMeanings:  []string{candidate.Definition},
			AcceptedTerms:     []string{candidate.Term},
		})
		if len(prompts) != 4 {
			t.Fatalf("row %d (%s) generated %d prompts, want 4", index+2, candidate.Term, len(prompts))
		}

		byType := make(map[memory.PromptType]memory.Prompt, len(prompts))
		for _, prompt := range prompts {
			byType[prompt.Type] = prompt
		}

		// A definition written with the ASCII/fullwidth semicolon becomes several
		// accepted answers, so the learner is not forced to type one exact gloss.
		if got := byType[memory.PromptEnglishToChinese].AcceptedAnswers; len(got) < 2 {
			t.Fatalf("row %d (%s) accepts only %v as a meaning; use ；to list senses", index+2, candidate.Term, got)
		}

		// The cloze is built by replacing the lowercase base form inside the
		// example. If the example omits it, the prompt degrades to a generic
		// "Choose the English expression for ..." with no real context.
		cloze := byType[memory.PromptContextCloze].Question
		if !strings.Contains(cloze, "_____") {
			t.Fatalf("row %d (%s) produced no blank: %q", index+2, candidate.Term, cloze)
		}
		if strings.HasPrefix(cloze, "Choose the English expression for") {
			t.Fatalf("row %d (%s) fell back to a context-free cloze; the example must contain %q verbatim", index+2, candidate.Term, candidate.Term)
		}
		if strings.Contains(cloze, candidate.Term) {
			t.Fatalf("row %d (%s) leaves the answer visible in the cloze: %q", index+2, candidate.Term, cloze)
		}
	}
}

// Upload -> Preview -> Commit is the only path a real import takes, so the seed
// list is driven through the whole service rather than through the mappers alone.
func TestSeedVocabularyCommitPopulatesDueQueue(t *testing.T) {
	ctx := context.Background()
	dataDir := t.TempDir()
	store, err := db.Open(ctx, filepath.Join(dataDir, "study.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()

	file, err := os.Open(filepath.FromSlash(seedPath))
	if err != nil {
		t.Fatalf("open seed list: %v", err)
	}
	defer file.Close()

	service := NewService(store, dataDir)
	upload, err := service.Upload(ctx, file, "english-gaokao-core.csv", "")
	if err != nil {
		t.Fatalf("upload seed list: %v", err)
	}

	preview, err := service.Preview(ctx, upload.JobID, Mapping{
		Term:          "term",
		Definition:    "definition",
		PartOfSpeech:  "part_of_speech",
		Pronunciation: "pronunciation",
		Example:       "example",
		Level:         "level",
		Subject:       "subject",
		Tags:          "tags",
	})
	if err != nil {
		t.Fatalf("preview seed list: %v", err)
	}
	if preview.Summary.Invalid != 0 {
		t.Fatalf("preview rejected %d rows", preview.Summary.Invalid)
	}
	if preview.Summary.Insert != preview.Summary.Rows {
		t.Fatalf("preview wants to insert %d of %d rows", preview.Summary.Insert, preview.Summary.Rows)
	}

	commit, err := service.Commit(ctx, upload.JobID, nil)
	if err != nil {
		t.Fatalf("commit seed list: %v", err)
	}
	if commit.Summary.Inserted != preview.Summary.Rows {
		t.Fatalf("inserted %d rows, want %d", commit.Summary.Inserted, preview.Summary.Rows)
	}
	// Four English prompts per word_sense: en_to_zh, zh_to_en, context_cloze, make_sentence.
	if want := commit.Summary.Inserted * 4; commit.Summary.PromptsCreated != want {
		t.Fatalf("created %d prompts, want %d", commit.Summary.PromptsCreated, want)
	}

	// Commit backdates nothing: every new card is due immediately, so the review
	// queue is usable straight after an import instead of after a scheduler tick.
	due, err := store.DuePromptsWithOptions(ctx, time.Now(), db.DuePromptOptions{Limit: 500, Subject: "english"})
	if err != nil {
		t.Fatalf("list due prompts: %v", err)
	}
	if len(due) == 0 {
		t.Fatal("import produced no due prompts")
	}

	recognition, err := store.DuePromptsWithOptions(ctx, time.Now(), db.DuePromptOptions{Limit: 500, Subject: "english", Mode: "recovery"})
	if err != nil {
		t.Fatalf("list recovery prompts: %v", err)
	}
	if len(recognition) == 0 {
		t.Fatal("import produced no recognition prompts for the recovery mode")
	}
}

func readSeed(t *testing.T) ([]map[string]any, []string) {
	t.Helper()

	file, err := os.Open(filepath.FromSlash(seedPath))
	if err != nil {
		t.Fatalf("open seed list: %v", err)
	}
	defer file.Close()

	records, err := csv.NewReader(file).ReadAll()
	if err != nil {
		t.Fatalf("parse seed list: %v", err)
	}
	if len(records) < 2 {
		t.Fatal("seed list has no data rows")
	}

	header := records[0]
	rows := make([]map[string]any, 0, len(records)-1)
	for index, record := range records[1:] {
		if len(record) != len(header) {
			t.Fatalf("row %d has %d fields, want %d", index+2, len(record), len(header))
		}
		row := make(map[string]any, len(header))
		for column, value := range record {
			row[header[column]] = value
		}
		rows = append(rows, row)
	}
	return rows, header
}
