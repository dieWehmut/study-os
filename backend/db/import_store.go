package db

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"study-os/backend/models"
)

func (s *Store) CreateSource(ctx context.Context, source models.Source) error {
	return createSource(ctx, s.db, source)
}

func (s *TxStore) CreateSource(ctx context.Context, source models.Source) error {
	return createSource(ctx, s.tx, source)
}

func createSource(ctx context.Context, database queryer, source models.Source) error {
	if strings.TrimSpace(source.ID) == "" || strings.TrimSpace(source.SourceType) == "" {
		return fmt.Errorf("source id and type are required")
	}
	metadata := source.MetadataJSON
	if len(metadata) == 0 {
		metadata = json.RawMessage(`{}`)
	}
	created := source.CreatedAt.UTC()
	if created.IsZero() {
		created = time.Now().UTC()
	}
	_, err := database.ExecContext(ctx, `INSERT INTO sources(id, source_type, name, original_name, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
		source.ID, source.SourceType, source.Name, source.OriginalName, string(metadata), formatTime(created))
	if err != nil {
		return fmt.Errorf("create source %q: %w", source.ID, err)
	}
	return nil
}

func (s *Store) CreateImportJob(ctx context.Context, job models.ImportJob) error {
	return createImportJob(ctx, s.db, job)
}

func (s *TxStore) CreateImportJob(ctx context.Context, job models.ImportJob) error {
	return createImportJob(ctx, s.tx, job)
}

func createImportJob(ctx context.Context, database queryer, job models.ImportJob) error {
	if strings.TrimSpace(job.ID) == "" || strings.TrimSpace(job.StagedPath) == "" {
		return fmt.Errorf("import job id and staged path are required")
	}
	mapping := job.MappingJSON
	if len(mapping) == 0 {
		mapping = json.RawMessage(`{}`)
	}
	created, updated := normalizedTimes(job.CreatedAt, job.UpdatedAt)
	_, err := database.ExecContext(ctx, `INSERT INTO import_jobs(id, source_id, staged_path, original_name, selected_table, mapping_json, state, created_at, updated_at) VALUES (?, NULLIF(?, ''), ?, ?, ?, ?, ?, ?, ?)`,
		job.ID, job.SourceID, job.StagedPath, job.OriginalName, job.SelectedTable, string(mapping), job.State, formatTime(created), formatTime(updated))
	if err != nil {
		return fmt.Errorf("create import job %q: %w", job.ID, err)
	}
	return nil
}

func (s *Store) GetImportJob(ctx context.Context, id string) (models.ImportJob, error) {
	return getImportJob(ctx, s.db, id)
}

func (s *TxStore) GetImportJob(ctx context.Context, id string) (models.ImportJob, error) {
	return getImportJob(ctx, s.tx, id)
}

func getImportJob(ctx context.Context, database queryer, id string) (models.ImportJob, error) {
	var job models.ImportJob
	var sourceID, mapping, created, updated string
	err := database.QueryRowContext(ctx, `SELECT id, COALESCE(source_id, ''), staged_path, original_name, selected_table, mapping_json, state, created_at, updated_at FROM import_jobs WHERE id = ?`, id).
		Scan(&job.ID, &sourceID, &job.StagedPath, &job.OriginalName, &job.SelectedTable, &mapping, &job.State, &created, &updated)
	if err != nil {
		return models.ImportJob{}, mapNotFound(err, "import job")
	}
	job.SourceID = sourceID
	job.MappingJSON = json.RawMessage(mapping)
	var parseErr error
	if job.CreatedAt, parseErr = parseTime(created); parseErr != nil {
		return models.ImportJob{}, fmt.Errorf("parse import job created time: %w", parseErr)
	}
	if job.UpdatedAt, parseErr = parseTime(updated); parseErr != nil {
		return models.ImportJob{}, fmt.Errorf("parse import job updated time: %w", parseErr)
	}
	return job, nil
}

func (s *Store) UpdateImportJob(ctx context.Context, job models.ImportJob) error {
	return updateImportJob(ctx, s.db, job)
}

func (s *TxStore) UpdateImportJob(ctx context.Context, job models.ImportJob) error {
	return updateImportJob(ctx, s.tx, job)
}

func updateImportJob(ctx context.Context, database queryer, job models.ImportJob) error {
	mapping := job.MappingJSON
	if len(mapping) == 0 {
		mapping = json.RawMessage(`{}`)
	}
	updated := job.UpdatedAt.UTC()
	if updated.IsZero() {
		updated = time.Now().UTC()
	}
	result, err := database.ExecContext(ctx, `UPDATE import_jobs SET source_id = NULLIF(?, ''), original_name = ?, selected_table = ?, mapping_json = ?, state = ?, updated_at = ? WHERE id = ?`,
		job.SourceID, job.OriginalName, job.SelectedTable, string(mapping), job.State, formatTime(updated), job.ID)
	if err != nil {
		return fmt.Errorf("update import job %q: %w", job.ID, err)
	}
	return requireChanged(result, "import job")
}

func (s *Store) CreateImportRow(ctx context.Context, row models.ImportRow) error {
	return createImportRow(ctx, s.db, row)
}

func (s *TxStore) CreateImportRow(ctx context.Context, row models.ImportRow) error {
	return createImportRow(ctx, s.tx, row)
}

func createImportRow(ctx context.Context, database queryer, row models.ImportRow) error {
	if strings.TrimSpace(row.ID) == "" || strings.TrimSpace(row.ImportJobID) == "" || len(row.RawJSON) == 0 {
		return fmt.Errorf("import row id, job, and raw JSON are required")
	}
	normalized := row.NormalizedJSON
	if len(normalized) == 0 {
		normalized = json.RawMessage(`{}`)
	}
	_, err := database.ExecContext(ctx, `INSERT INTO import_rows(id, import_job_id, row_number, raw_json, normalized_json, disposition, linked_knowledge_item_id) VALUES (?, ?, ?, ?, ?, ?, NULLIF(?, ''))`,
		row.ID, row.ImportJobID, row.RowNumber, string(row.RawJSON), string(normalized), row.Disposition, previewLinkedKnowledgeID(row))
	if err != nil {
		return fmt.Errorf("create import row %q: %w", row.ID, err)
	}
	return nil
}

func previewLinkedKnowledgeID(row models.ImportRow) string {
	// Matches within the same preview batch point at a deterministic future ID.
	// Defer the foreign-key link until that knowledge item is created at commit.
	if strings.HasPrefix(row.LinkedKnowledgeItemID, "knowledge-"+row.ImportJobID+"-row-") {
		return ""
	}
	return row.LinkedKnowledgeItemID
}

func (s *Store) UpdateImportRow(ctx context.Context, row models.ImportRow) error {
	return updateImportRow(ctx, s.db, row)
}

func (s *TxStore) UpdateImportRow(ctx context.Context, row models.ImportRow) error {
	return updateImportRow(ctx, s.tx, row)
}

func updateImportRow(ctx context.Context, database queryer, row models.ImportRow) error {
	result, err := database.ExecContext(ctx, `UPDATE import_rows SET normalized_json = ?, disposition = ?, linked_knowledge_item_id = NULLIF(?, '') WHERE id = ?`,
		string(row.NormalizedJSON), row.Disposition, row.LinkedKnowledgeItemID, row.ID)
	if err != nil {
		return fmt.Errorf("update import row %q: %w", row.ID, err)
	}
	return requireChanged(result, "import row")
}

func (s *Store) ListImportRows(ctx context.Context, jobID string) ([]models.ImportRow, error) {
	return listImportRows(ctx, s.db, jobID)
}

func (s *TxStore) ListImportRows(ctx context.Context, jobID string) ([]models.ImportRow, error) {
	return listImportRows(ctx, s.tx, jobID)
}

func (s *TxStore) DeleteImportRows(ctx context.Context, jobID string) error {
	if _, err := s.tx.ExecContext(ctx, `DELETE FROM import_rows WHERE import_job_id = ?`, jobID); err != nil {
		return fmt.Errorf("delete import rows for %q: %w", jobID, err)
	}
	return nil
}

// ReplaceImportRowsPreview atomically replaces preview rows only while the
// job is still in an editable state. A commit that wins the race causes a
// conflict instead of allowing stale preview data to roll the job backwards.
func (s *TxStore) ReplaceImportRowsPreview(ctx context.Context, job models.ImportJob, rows []models.ImportRow) error {
	var state string
	if err := s.tx.QueryRowContext(ctx, `SELECT state FROM import_jobs WHERE id = ?`, job.ID).Scan(&state); err != nil {
		return mapNotFound(err, "import job")
	}
	if state == "committed" {
		return fmt.Errorf("import job is already committed")
	}
	if _, err := s.tx.ExecContext(ctx, `DELETE FROM import_rows WHERE import_job_id = ?`, job.ID); err != nil {
		return fmt.Errorf("delete import rows for %q: %w", job.ID, err)
	}
	for _, row := range rows {
		if err := createImportRow(ctx, s.tx, row); err != nil {
			return err
		}
	}
	result, err := s.tx.ExecContext(ctx, `UPDATE import_jobs SET source_id = NULLIF(?, ''), original_name = ?, selected_table = ?, mapping_json = ?, state = ?, updated_at = ? WHERE id = ? AND state <> 'committed'`,
		job.SourceID, job.OriginalName, job.SelectedTable, string(job.MappingJSON), job.State, formatTime(job.UpdatedAt), job.ID)
	if err != nil {
		return fmt.Errorf("update import job preview %q: %w", job.ID, err)
	}
	return requireChanged(result, "import job preview")
}

func listImportRows(ctx context.Context, database queryer, jobID string) ([]models.ImportRow, error) {
	rows, err := database.QueryContext(ctx, `SELECT id, import_job_id, row_number, raw_json, normalized_json, disposition, COALESCE(linked_knowledge_item_id, '') FROM import_rows WHERE import_job_id = ? ORDER BY row_number ASC`, jobID)
	if err != nil {
		return nil, fmt.Errorf("list import rows: %w", err)
	}
	defer rows.Close()
	result := make([]models.ImportRow, 0)
	for rows.Next() {
		var row models.ImportRow
		var raw, normalized string
		if err := rows.Scan(&row.ID, &row.ImportJobID, &row.RowNumber, &raw, &normalized, &row.Disposition, &row.LinkedKnowledgeItemID); err != nil {
			return nil, fmt.Errorf("scan import row: %w", err)
		}
		row.RawJSON = json.RawMessage(raw)
		row.NormalizedJSON = json.RawMessage(normalized)
		result = append(result, row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate import rows: %w", err)
	}
	return result, nil
}

func (s *Store) CreateDedupReview(ctx context.Context, review models.DedupReview) error {
	return createDedupReview(ctx, s.db, review)
}

func (s *TxStore) CreateDedupReview(ctx context.Context, review models.DedupReview) error {
	return createDedupReview(ctx, s.tx, review)
}

func createDedupReview(ctx context.Context, database queryer, review models.DedupReview) error {
	created := review.CreatedAt.UTC()
	if created.IsZero() {
		created = time.Now().UTC()
	}
	var resolved any
	if review.ResolvedAt != nil {
		resolved = formatTime(*review.ResolvedAt)
	}
	_, err := database.ExecContext(ctx, `INSERT INTO dedup_reviews(id, import_row_id, existing_knowledge_item_id, state, resolution, created_at, resolved_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		review.ID, review.ImportRowID, review.ExistingKnowledgeItemID, review.State, review.Resolution, formatTime(created), resolved)
	if err != nil {
		return fmt.Errorf("create dedup review %q: %w", review.ID, err)
	}
	return nil
}
