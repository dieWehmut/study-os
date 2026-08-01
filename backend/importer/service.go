package importer

import (
	"bufio"
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"time"

	fsrs "github.com/open-spaced-repetition/go-fsrs/v3"
	_ "modernc.org/sqlite"

	"study-os/backend/db"
	"study-os/backend/memory"
	"study-os/backend/models"
)

const (
	jobStateUploaded  = "uploaded"
	jobStatePreviewed = "previewed"
	jobStateCommitted = "committed"
)

type Mapping struct {
	Term          string `json:"term"`
	Definition    string `json:"definition"`
	ItemType      string `json:"item_type,omitempty"`
	PartOfSpeech  string `json:"part_of_speech,omitempty"`
	Pronunciation string `json:"pronunciation,omitempty"`
	Example       string `json:"example,omitempty"`
	Wiki          string `json:"wiki,omitempty"`
	Level         string `json:"level,omitempty"`
	Tags          string `json:"tags,omitempty"`
}

type UploadResult struct {
	JobID      string     `json:"job_id"`
	Inspection Inspection `json:"inspection"`
}

type JobView struct {
	JobID      string     `json:"job_id"`
	State      string     `json:"state"`
	Mapping    Mapping    `json:"mapping"`
	Inspection Inspection `json:"inspection"`
}

type PreviewRow struct {
	RowID                  string      `json:"row_id"`
	RowNumber              int         `json:"row_number"`
	Raw                    any         `json:"raw"`
	Normalized             *Candidate  `json:"normalized,omitempty"`
	Disposition            Disposition `json:"disposition"`
	MatchedKnowledgeItemID string      `json:"matched_knowledge_item_id,omitempty"`
	Error                  string      `json:"error,omitempty"`
}

type PreviewSummary struct {
	Rows           int `json:"rows"`
	Insert         int `json:"insert"`
	ExactDuplicate int `json:"exact_duplicate"`
	Review         int `json:"review"`
	NewSense       int `json:"new_sense"`
	Invalid        int `json:"invalid"`
}

type PreviewResult struct {
	JobID   string         `json:"job_id"`
	State   string         `json:"state"`
	Mapping Mapping        `json:"mapping"`
	Summary PreviewSummary `json:"summary"`
	Rows    []PreviewRow   `json:"rows"`
}

type CommitSummary struct {
	Inserted        int `json:"inserted"`
	ExactDuplicates int `json:"exact_duplicates"`
	Merged          int `json:"merged"`
	PendingReviews  int `json:"pending_reviews"`
	Rejected        int `json:"rejected"`
	PromptsCreated  int `json:"prompts_created"`
}

type CommitResult struct {
	JobID   string        `json:"job_id"`
	State   string        `json:"state"`
	Summary CommitSummary `json:"summary"`
}

type Service struct {
	Store             *db.Store
	DataDir           string
	beforePreviewSave func()
}

func NewService(store *db.Store, dataDir string) *Service {
	return &Service{Store: store, DataDir: dataDir}
}

func (s *Service) Upload(ctx context.Context, source io.Reader, originalName, selectedTable string) (UploadResult, error) {
	if s == nil || s.Store == nil {
		return UploadResult{}, errors.New("import service unavailable")
	}
	if source == nil {
		return UploadResult{}, errors.New("upload body is empty")
	}
	ext := strings.ToLower(filepath.Ext(originalName))
	if ext != ".csv" && ext != ".jsonl" && ext != ".ndjson" && ext != ".sqlite" && ext != ".sqlite3" && ext != ".db" {
		return UploadResult{}, fmt.Errorf("unsupported import extension %q", ext)
	}
	jobID := newImportID("import")
	root := s.DataDir
	if strings.TrimSpace(root) == "" {
		root = "data"
	}
	stagingDir := filepath.Join(root, "imports")
	if err := os.MkdirAll(stagingDir, 0o700); err != nil {
		return UploadResult{}, fmt.Errorf("create import staging directory: %w", err)
	}
	temporary, err := os.CreateTemp(stagingDir, ".upload-*")
	if err != nil {
		return UploadResult{}, fmt.Errorf("create staged import: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		_ = temporary.Close()
		return UploadResult{}, fmt.Errorf("secure staged import: %w", err)
	}
	limited := io.LimitReader(source, MaxImportBytes+1)
	written, copyErr := io.Copy(temporary, limited)
	closeErr := temporary.Close()
	if copyErr != nil {
		return UploadResult{}, fmt.Errorf("stage import: %w", copyErr)
	}
	if closeErr != nil {
		return UploadResult{}, fmt.Errorf("close staged import: %w", closeErr)
	}
	if written > MaxImportBytes {
		return UploadResult{}, errors.New("import exceeds 25 MiB")
	}
	stagedPath := filepath.Join(stagingDir, jobID+ext)
	if err := os.Rename(temporaryPath, stagedPath); err != nil {
		return UploadResult{}, fmt.Errorf("finalize staged import: %w", err)
	}
	inspection, err := InspectFile(ctx, stagedPath, selectedTable)
	if err != nil {
		_ = os.Remove(stagedPath)
		return UploadResult{}, err
	}
	now := time.Now().UTC()
	job := models.ImportJob{ID: jobID, StagedPath: stagedPath, OriginalName: filepath.Base(originalName), SelectedTable: inspection.SelectedTable, MappingJSON: json.RawMessage(`{}`), State: jobStateUploaded, CreatedAt: now, UpdatedAt: now}
	if err := s.Store.CreateImportJob(ctx, job); err != nil {
		_ = os.Remove(stagedPath)
		return UploadResult{}, err
	}
	return UploadResult{JobID: jobID, Inspection: redactInspection(inspection)}, nil
}

func (s *Service) Get(ctx context.Context, id string) (JobView, error) {
	job, err := s.Store.GetImportJob(ctx, id)
	if err != nil {
		return JobView{}, err
	}
	inspection, err := InspectFile(ctx, job.StagedPath, job.SelectedTable)
	if err != nil {
		return JobView{}, err
	}
	var mapping Mapping
	if len(job.MappingJSON) > 0 && string(job.MappingJSON) != "{}" {
		if err := json.Unmarshal(job.MappingJSON, &mapping); err != nil {
			return JobView{}, fmt.Errorf("decode import mapping: %w", err)
		}
	}
	return JobView{JobID: job.ID, State: job.State, Mapping: mapping, Inspection: redactInspection(inspection)}, nil
}

func (s *Service) Preview(ctx context.Context, id string, mapping Mapping) (PreviewResult, error) {
	job, err := s.Store.GetImportJob(ctx, id)
	if err != nil {
		return PreviewResult{}, err
	}
	if job.State == jobStateCommitted {
		return PreviewResult{}, errors.New("import job is already committed")
	}
	inspection, err := InspectFile(ctx, job.StagedPath, job.SelectedTable)
	if err != nil {
		return PreviewResult{}, err
	}
	if err := validateMapping(mapping, inspection.Columns); err != nil {
		return PreviewResult{}, err
	}
	rows, err := readRows(ctx, job.StagedPath, inspection.Format, job.SelectedTable)
	if err != nil {
		return PreviewResult{}, err
	}
	existing, err := s.Store.ListKnowledgeItemsForDedup(ctx)
	if err != nil {
		return PreviewResult{}, err
	}
	existingCandidates := make([]Candidate, 0, len(existing)+len(rows))
	for _, item := range existing {
		existingCandidates = append(existingCandidates, candidateFromKnowledge(item))
	}
	previewRows := make([]PreviewRow, 0, len(rows))
	storedRows := make([]models.ImportRow, 0, len(rows))
	var summary PreviewSummary
	for index, row := range rows {
		preview := PreviewRow{RowID: fmt.Sprintf("%s-row-%d", id, index+1), RowNumber: index + 1, Raw: row.Value}
		candidate, candidateErr := mapCandidate(row.Value, mapping, row.RawJSON)
		if candidateErr != nil {
			preview.Disposition = "invalid"
			preview.Error = candidateErr.Error()
			summary.Invalid++
		} else {
			candidate = NormalizeCandidate(candidate)
			result := ResolveDuplicate(existingCandidates, candidate)
			if result.Disposition == DispositionInsert || result.Disposition == DispositionNewSense {
				result.Incoming.KnowledgeItemID = "knowledge-" + preview.RowID
			}
			preview.Normalized = &result.Incoming
			preview.Disposition = result.Disposition
			if result.Matched != nil {
				preview.MatchedKnowledgeItemID = result.Matched.KnowledgeItemID
			}
			switch result.Disposition {
			case DispositionInsert:
				summary.Insert++
				existingCandidates = append(existingCandidates, result.Incoming)
			case DispositionExact:
				summary.ExactDuplicate++
			case DispositionReview:
				summary.Review++
			case DispositionNewSense:
				summary.NewSense++
				existingCandidates = append(existingCandidates, result.Incoming)
			}
		}
		summary.Rows++
		normalizedJSON, _ := json.Marshal(preview.Normalized)
		if preview.Normalized == nil {
			normalizedJSON = json.RawMessage(`{}`)
		}
		storedRows = append(storedRows, models.ImportRow{ID: preview.RowID, ImportJobID: id, RowNumber: preview.RowNumber, RawJSON: row.RawJSON, NormalizedJSON: normalizedJSON, Disposition: string(preview.Disposition), LinkedKnowledgeItemID: preview.MatchedKnowledgeItemID})
		previewRows = append(previewRows, preview)
	}
	mappingJSON, _ := json.Marshal(mapping)
	now := time.Now().UTC()
	if s.beforePreviewSave != nil {
		s.beforePreviewSave()
	}
	if err := s.Store.WithTx(ctx, func(tx *db.TxStore) error {
		return tx.ReplaceImportRowsPreview(ctx, models.ImportJob{ID: id, SourceID: job.SourceID, StagedPath: job.StagedPath, OriginalName: job.OriginalName, SelectedTable: job.SelectedTable, MappingJSON: mappingJSON, State: jobStatePreviewed, UpdatedAt: now}, storedRows)
	}); err != nil {
		return PreviewResult{}, err
	}
	return PreviewResult{JobID: id, State: jobStatePreviewed, Mapping: mapping, Summary: summary, Rows: previewRows}, nil
}

func (s *Service) Commit(ctx context.Context, id string, resolutions map[string]string) (CommitResult, error) {
	if s == nil || s.Store == nil {
		return CommitResult{}, errors.New("import service unavailable")
	}
	var summary CommitSummary
	alreadyCommitted := false
	err := s.Store.WithTx(ctx, func(tx *db.TxStore) error {
		job, err := tx.GetImportJob(ctx, id)
		if err != nil {
			return err
		}
		if job.State == jobStateCommitted {
			alreadyCommitted = true
			return nil
		}
		if job.State != jobStatePreviewed {
			return errors.New("import job must be previewed before commit")
		}
		rows, err := tx.ListImportRows(ctx, id)
		if err != nil {
			return err
		}
		if len(rows) == 0 {
			return errors.New("import preview has no rows")
		}
		existing, err := tx.ListKnowledgeItemsForDedup(ctx)
		if err != nil {
			return err
		}
		existingCandidates := make([]Candidate, 0, len(existing)+len(rows))
		for _, item := range existing {
			existingCandidates = append(existingCandidates, candidateFromKnowledge(item))
		}
		now := time.Now().UTC()
		sourceID := job.SourceID
		if sourceID == "" {
			sourceID = "source-" + id
			sourceName := job.OriginalName
			if sourceName == "" {
				sourceName = filepath.Base(job.StagedPath)
			}
			source := models.Source{ID: sourceID, SourceType: string(formatFromPath(job.StagedPath)), Name: sourceName, OriginalName: sourceName, CreatedAt: now}
			if err := tx.CreateSource(ctx, source); err != nil {
				return err
			}
		}
		for _, row := range rows {
			var candidate Candidate
			if err := json.Unmarshal(row.NormalizedJSON, &candidate); err != nil || candidate.Term == "" {
				row.Disposition = "rejected"
				summary.Rejected++
				if err := tx.UpdateImportRow(ctx, row); err != nil {
					return err
				}
				continue
			}
			candidate = NormalizeCandidate(candidate)
			duplicate := ResolveDuplicate(existingCandidates, candidate)
			disposition := duplicate.Disposition
			matchedID := ""
			if duplicate.Matched != nil {
				matchedID = duplicate.Matched.KnowledgeItemID
			}
			if disposition == DispositionExact {
				if matchedID == "" {
					return fmt.Errorf("exact duplicate row %q has no match", row.ID)
				}
				row.Disposition = string(DispositionExact)
				row.LinkedKnowledgeItemID = matchedID
				summary.ExactDuplicates++
				if err := tx.UpdateImportRow(ctx, row); err != nil {
					return err
				}
				continue
			}
			if disposition == DispositionReview {
				resolution := strings.ToLower(strings.TrimSpace(resolutions[row.ID]))
				switch resolution {
				case "merge":
					if matchedID == "" {
						return fmt.Errorf("review row %q has no match", row.ID)
					}
					row.Disposition = "merged"
					row.LinkedKnowledgeItemID = matchedID
					summary.Merged++
					if err := tx.UpdateImportRow(ctx, row); err != nil {
						return err
					}
					continue
				case "new_sense":
					disposition = DispositionNewSense
				case "reject":
					row.Disposition = "rejected"
					summary.Rejected++
					if err := tx.UpdateImportRow(ctx, row); err != nil {
						return err
					}
					continue
				default:
					reviewID := fmt.Sprintf("%s-review-%s", id, row.ID)
					if matchedID == "" {
						return fmt.Errorf("review row %q has no match", row.ID)
					}
					row.LinkedKnowledgeItemID = matchedID
					if err := tx.CreateDedupReview(ctx, models.DedupReview{ID: reviewID, ImportRowID: row.ID, ExistingKnowledgeItemID: matchedID, State: "pending", CreatedAt: now}); err != nil {
						return err
					}
					summary.PendingReviews++
					if err := tx.UpdateImportRow(ctx, row); err != nil {
						return err
					}
					continue
				}
			}
			itemID := "knowledge-" + row.ID
			item := models.KnowledgeItem{ID: itemID, SourceID: sourceID, ItemType: candidate.ItemType, Term: candidate.Term, PartOfSpeech: candidate.PartOfSpeech, Pronunciation: candidate.Pronunciation, ConciseDefinition: candidate.Definition, DetailedMarkdown: candidate.Wiki, Example: candidate.Example, Level: candidate.Level, Tags: candidate.Tags, Fingerprint: candidate.Fingerprint, CreatedAt: now, UpdatedAt: now}
			if err := tx.CreateKnowledgeItem(ctx, item); err != nil {
				return err
			}
			generated := memory.GeneratePrompts(memory.KnowledgeItem{ID: item.ID, Term: item.Term, ConciseDefinition: item.ConciseDefinition, Example: item.Example, AcceptedMeanings: []string{item.ConciseDefinition}, AcceptedTerms: []string{item.Term}})
			for index, generatedPrompt := range generated {
				promptID := fmt.Sprintf("%s-prompt-%d", item.ID, index+1)
				if err := tx.CreatePrompt(ctx, models.Prompt{ID: promptID, KnowledgeItemID: item.ID, PromptType: string(generatedPrompt.Type), Question: generatedPrompt.Question, AcceptedAnswers: generatedPrompt.AcceptedAnswers, CreatedAt: now, UpdatedAt: now}); err != nil {
					return err
				}
				card := fsrs.NewCard()
				card.Due = now
				cardJSON, err := json.Marshal(card)
				if err != nil {
					return err
				}
				if err := tx.UpsertReviewState(ctx, models.ReviewState{PromptID: promptID, CardJSON: cardJSON, DueAt: card.Due, UpdatedAt: now}); err != nil {
					return err
				}
				summary.PromptsCreated++
			}
			candidate.KnowledgeItemID = item.ID
			existingCandidates = append(existingCandidates, candidate)
			row.LinkedKnowledgeItemID = item.ID
			if disposition == DispositionNewSense {
				row.Disposition = string(DispositionNewSense)
			} else {
				row.Disposition = string(DispositionInsert)
			}
			summary.Inserted++
			if err := tx.UpdateImportRow(ctx, row); err != nil {
				return err
			}
		}
		job.SourceID = sourceID
		job.State = jobStateCommitted
		job.UpdatedAt = now
		if err := tx.UpdateImportJob(ctx, job); err != nil {
			return err
		}
		payload, _ := json.Marshal(summary)
		return tx.AppendDomainEvent(ctx, models.DomainEvent{ID: "event-import-" + id, EventType: "import_committed", AggregateID: id, PayloadJSON: payload, OccurredAt: now})
	})
	if err != nil {
		return CommitResult{}, err
	}
	if alreadyCommitted {
		storedSummary, err := s.committedSummary(ctx, id)
		if err != nil {
			return CommitResult{}, err
		}
		return CommitResult{JobID: id, State: jobStateCommitted, Summary: storedSummary}, nil
	}
	return CommitResult{JobID: id, State: jobStateCommitted, Summary: summary}, nil
}

func (s *Service) committedSummary(ctx context.Context, id string) (CommitSummary, error) {
	rows, err := s.Store.ListImportRows(ctx, id)
	if err != nil {
		return CommitSummary{}, err
	}
	var summary CommitSummary
	for _, row := range rows {
		switch row.Disposition {
		case string(DispositionInsert), string(DispositionNewSense):
			summary.Inserted++
			summary.PromptsCreated += 3
		case string(DispositionExact):
			summary.ExactDuplicates++
		case "merged":
			summary.Merged++
		case "review":
			summary.PendingReviews++
		case "rejected":
			summary.Rejected++
		}
	}
	return summary, nil
}

type sourceRow struct {
	Value   map[string]any
	RawJSON json.RawMessage
}

func readRows(ctx context.Context, path string, format Format, table string) ([]sourceRow, error) {
	switch format {
	case FormatCSV:
		return readCSVRows(ctx, path)
	case FormatJSONL:
		return readJSONLRows(ctx, path)
	case FormatSQLite:
		return readSQLiteRows(ctx, path, table)
	default:
		return nil, fmt.Errorf("unsupported import format %q", format)
	}
}

func readCSVRows(ctx context.Context, path string) ([]sourceRow, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	reader := csvReader(file)
	headers, err := reader.Read()
	if err != nil {
		return nil, err
	}
	if len(headers) > 0 {
		headers[0] = strings.TrimPrefix(headers[0], "\ufeff")
	}
	result := make([]sourceRow, 0)
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		values, err := reader.Read()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, err
		}
		value := rowMap(headers, values)
		raw, _ := json.Marshal(value)
		result = append(result, sourceRow{Value: value, RawJSON: raw})
	}
	return result, nil
}

func readJSONLRows(ctx context.Context, path string) ([]sourceRow, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 64*1024), int(MaxImportBytes))
	result := make([]sourceRow, 0)
	for scanner.Scan() {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var value map[string]any
		decoder := json.NewDecoder(strings.NewReader(line))
		decoder.UseNumber()
		if err := decoder.Decode(&value); err != nil || value == nil {
			if err == nil {
				err = errors.New("expected JSON object")
			}
			return nil, err
		}
		result = append(result, sourceRow{Value: value, RawJSON: json.RawMessage(line)})
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

func readSQLiteRows(ctx context.Context, path, table string) ([]sourceRow, error) {
	inspection, err := InspectFile(ctx, path, table)
	if err != nil {
		return nil, err
	}
	database, err := sql.Open("sqlite", path+"?mode=ro")
	if err != nil {
		return nil, err
	}
	defer database.Close()
	quoted := `"` + strings.ReplaceAll(inspection.SelectedTable, `"`, `""`) + `"`
	rows, err := database.QueryContext(ctx, `SELECT * FROM `+quoted)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	columns, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	result := make([]sourceRow, 0)
	for rows.Next() {
		values := make([]any, len(columns))
		pointers := make([]any, len(columns))
		for i := range values {
			pointers[i] = &values[i]
		}
		if err := rows.Scan(pointers...); err != nil {
			return nil, err
		}
		value := make(map[string]any, len(columns))
		for i, column := range columns {
			if bytes, ok := values[i].([]byte); ok {
				value[column] = string(bytes)
			} else {
				value[column] = values[i]
			}
		}
		raw, _ := json.Marshal(value)
		result = append(result, sourceRow{Value: value, RawJSON: raw})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

func csvReader(file io.Reader) *csv.Reader {
	reader := csv.NewReader(file)
	return reader
}

func validateMapping(mapping Mapping, columns []string) error {
	if strings.TrimSpace(mapping.Term) == "" || strings.TrimSpace(mapping.Definition) == "" {
		return errors.New("term and definition mappings are required")
	}
	for field, column := range map[string]string{"term": mapping.Term, "definition": mapping.Definition, "item_type": mapping.ItemType, "part_of_speech": mapping.PartOfSpeech, "pronunciation": mapping.Pronunciation, "example": mapping.Example, "wiki": mapping.Wiki, "level": mapping.Level, "tags": mapping.Tags} {
		if strings.TrimSpace(column) != "" && !contains(columns, column) {
			return fmt.Errorf("mapping %s references unknown column %q", field, column)
		}
	}
	return nil
}

func mapCandidate(value map[string]any, mapping Mapping, raw json.RawMessage) (Candidate, error) {
	itemType := valueString(value[mapping.ItemType])
	if strings.TrimSpace(mapping.ItemType) == "" || itemType == "" {
		itemType = "word_sense"
	}
	itemType = normalizeToken(itemType)
	if itemType != "word_sense" && itemType != "phrase" && itemType != "collocation" {
		return Candidate{}, fmt.Errorf("unsupported item_type %q", itemType)
	}
	candidate := Candidate{ItemType: itemType, Term: valueString(value[mapping.Term]), Definition: valueString(value[mapping.Definition]), PartOfSpeech: valueString(value[mapping.PartOfSpeech]), Pronunciation: valueString(value[mapping.Pronunciation]), Example: valueString(value[mapping.Example]), Wiki: valueString(value[mapping.Wiki]), Level: valueString(value[mapping.Level]), Tags: valueTags(value[mapping.Tags]), RawJSON: string(raw)}
	if strings.TrimSpace(candidate.Term) == "" || strings.TrimSpace(candidate.Definition) == "" {
		return Candidate{}, errors.New("term and definition are required")
	}
	return candidate, nil
}

func candidateFromKnowledge(item models.KnowledgeItem) Candidate {
	return Candidate{KnowledgeItemID: item.ID, ItemType: item.ItemType, Term: item.Term, PartOfSpeech: item.PartOfSpeech, Pronunciation: item.Pronunciation, Definition: item.ConciseDefinition, Example: item.Example, Wiki: item.DetailedMarkdown, Level: item.Level, Tags: item.Tags, Fingerprint: item.Fingerprint}
}

func valueString(value any) string {
	if value == nil {
		return ""
	}
	if text, ok := value.(string); ok {
		return text
	}
	if number, ok := value.(json.Number); ok {
		return number.String()
	}
	if bytes, ok := value.([]byte); ok {
		return string(bytes)
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return fmt.Sprint(value)
	}
	return string(encoded)
}

func valueTags(value any) []string {
	if value == nil {
		return nil
	}
	if values, ok := value.([]any); ok {
		result := make([]string, 0, len(values))
		for _, item := range values {
			result = append(result, valueString(item))
		}
		return result
	}
	text := valueString(value)
	if strings.HasPrefix(strings.TrimSpace(text), "[") {
		var values []string
		if json.Unmarshal([]byte(text), &values) == nil {
			return values
		}
	}
	return strings.FieldsFunc(text, func(r rune) bool { return r == ',' || r == ';' || r == '|' || r == '\uff0c' || r == '\uff1b' })
}

func formatFromPath(path string) Format {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".jsonl", ".ndjson":
		return FormatJSONL
	case ".sqlite", ".sqlite3", ".db":
		return FormatSQLite
	default:
		return FormatCSV
	}
}

func redactInspection(inspection Inspection) Inspection {
	for rowIndex, row := range inspection.SampleRows {
		for key, value := range row {
			lower := strings.ToLower(key)
			if strings.Contains(lower, "password") || strings.Contains(lower, "secret") || strings.Contains(lower, "token") || strings.Contains(lower, "api_key") {
				row[key] = "[redacted]"
				continue
			}
			if text, ok := value.(string); ok && len(text) > 256 {
				row[key] = text[:256] + "…"
			}
		}
		inspection.SampleRows[rowIndex] = row
	}
	return inspection
}

var importSequence atomic.Uint64

func newImportID(prefix string) string {
	sequence := importSequence.Add(1)
	var random [5]byte
	_, _ = rand.Read(random[:])
	return fmt.Sprintf("%s-%d-%x", prefix, sequence, random)
}
