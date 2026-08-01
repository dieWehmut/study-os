package importer

import (
	"bufio"
	"context"
	"database/sql"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	_ "modernc.org/sqlite"
)

const MaxImportBytes int64 = 25 << 20

type Format string

const (
	FormatCSV    Format = "csv"
	FormatJSONL  Format = "jsonl"
	FormatSQLite Format = "sqlite"
)

type Inspection struct {
	Format        Format           `json:"format"`
	Tables        []string         `json:"tables,omitempty"`
	Columns       []string         `json:"columns"`
	SampleRows    []map[string]any `json:"sample_rows"`
	RowCount      int              `json:"row_count"`
	SelectedTable string           `json:"selected_table,omitempty"`
}

func InspectFile(ctx context.Context, path string, table string) (Inspection, error) {
	if err := ctx.Err(); err != nil {
		return Inspection{}, err
	}
	info, err := os.Stat(path)
	if err != nil {
		return Inspection{}, fmt.Errorf("stat import: %w", err)
	}
	if !info.Mode().IsRegular() || info.Size() > MaxImportBytes {
		return Inspection{}, errors.New("import must be a regular file no larger than 25 MiB")
	}
	switch strings.ToLower(filepath.Ext(path)) {
	case ".csv":
		return inspectCSV(ctx, path)
	case ".jsonl", ".ndjson":
		return inspectJSONL(ctx, path)
	case ".sqlite", ".db", ".sqlite3":
		return inspectSQLite(ctx, path, table)
	default:
		return Inspection{}, fmt.Errorf("unsupported import extension %q", filepath.Ext(path))
	}
}

func inspectCSV(ctx context.Context, path string) (Inspection, error) {
	file, err := os.Open(path)
	if err != nil {
		return Inspection{}, err
	}
	defer file.Close()
	reader := csv.NewReader(file)
	headers, err := reader.Read()
	if err != nil {
		return Inspection{}, fmt.Errorf("read csv header: %w", err)
	}
	if len(headers) > 0 {
		headers[0] = strings.TrimPrefix(headers[0], "\ufeff")
	}
	seenHeaders := make(map[string]struct{}, len(headers))
	for _, header := range headers {
		if strings.TrimSpace(header) == "" {
			return Inspection{}, errors.New("csv headers must not be empty")
		}
		if _, exists := seenHeaders[header]; exists {
			return Inspection{}, fmt.Errorf("duplicate csv header %q", header)
		}
		seenHeaders[header] = struct{}{}
	}
	inspection := Inspection{Format: FormatCSV, Columns: headers, SampleRows: make([]map[string]any, 0, 5)}
	for {
		if err := ctx.Err(); err != nil {
			return Inspection{}, err
		}
		row, readErr := reader.Read()
		if errors.Is(readErr, io.EOF) {
			break
		}
		if readErr != nil {
			return Inspection{}, fmt.Errorf("read csv row: %w", readErr)
		}
		inspection.RowCount++
		if len(inspection.SampleRows) < 5 {
			inspection.SampleRows = append(inspection.SampleRows, rowMap(headers, row))
		}
	}
	return inspection, nil
}

func inspectJSONL(ctx context.Context, path string) (Inspection, error) {
	file, err := os.Open(path)
	if err != nil {
		return Inspection{}, err
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 64*1024), int(MaxImportBytes))
	inspection := Inspection{Format: FormatJSONL, SampleRows: make([]map[string]any, 0, 5)}
	for scanner.Scan() {
		if err := ctx.Err(); err != nil {
			return Inspection{}, err
		}
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var row map[string]any
		if err := json.Unmarshal([]byte(line), &row); err != nil {
			return Inspection{}, fmt.Errorf("decode jsonl row %d: %w", inspection.RowCount+1, err)
		}
		if row == nil {
			return Inspection{}, fmt.Errorf("decode jsonl row %d: expected object", inspection.RowCount+1)
		}
		inspection.RowCount++
		if len(inspection.SampleRows) < 5 {
			inspection.SampleRows = append(inspection.SampleRows, row)
		}
		for key := range row {
			if !contains(inspection.Columns, key) {
				inspection.Columns = append(inspection.Columns, key)
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return Inspection{}, err
	}
	return inspection, nil
}

func inspectSQLite(ctx context.Context, path, table string) (Inspection, error) {
	db, err := sql.Open("sqlite", path+"?mode=ro")
	if err != nil {
		return Inspection{}, err
	}
	defer db.Close()
	tableRows, err := db.QueryContext(ctx, `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
	if err != nil {
		return Inspection{}, fmt.Errorf("list sqlite tables: %w", err)
	}
	var tables []string
	for tableRows.Next() {
		var name string
		if err := tableRows.Scan(&name); err != nil {
			tableRows.Close()
			return Inspection{}, fmt.Errorf("scan sqlite table: %w", err)
		}
		tables = append(tables, name)
	}
	if err := tableRows.Close(); err != nil {
		return Inspection{}, fmt.Errorf("close sqlite tables: %w", err)
	}
	if err := tableRows.Err(); err != nil {
		return Inspection{}, fmt.Errorf("iterate sqlite tables: %w", err)
	}
	if len(tables) == 0 {
		return Inspection{}, errors.New("sqlite import has no user tables")
	}
	if table == "" {
		table = tables[0]
	}
	if !contains(tables, table) {
		return Inspection{}, fmt.Errorf("sqlite table %q is not an allowed user table", table)
	}
	quotedTable := `"` + strings.ReplaceAll(table, `"`, `""`) + `"`
	var rowCount int
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM `+quotedTable).Scan(&rowCount); err != nil {
		return Inspection{}, fmt.Errorf("count sqlite table: %w", err)
	}
	rows, err := db.QueryContext(ctx, `SELECT * FROM `+quotedTable+` LIMIT 5`)
	if err != nil {
		return Inspection{}, fmt.Errorf("read sqlite table: %w", err)
	}
	defer rows.Close()
	columns, err := rows.Columns()
	if err != nil {
		return Inspection{}, err
	}
	inspection := Inspection{Format: FormatSQLite, Tables: tables, Columns: columns, SelectedTable: table, RowCount: rowCount, SampleRows: make([]map[string]any, 0, 5)}
	for rows.Next() {
		values := make([]any, len(columns))
		pointers := make([]any, len(columns))
		for i := range values {
			pointers[i] = &values[i]
		}
		if err := rows.Scan(pointers...); err != nil {
			return Inspection{}, err
		}
		row := make(map[string]any, len(columns))
		for i, column := range columns {
			row[column] = values[i]
		}
		inspection.SampleRows = append(inspection.SampleRows, row)
	}
	if err := rows.Err(); err != nil {
		return Inspection{}, err
	}
	return inspection, nil
}

func rowMap(headers, values []string) map[string]any {
	row := make(map[string]any, len(headers))
	for index, header := range headers {
		if index < len(values) {
			row[header] = values[index]
		}
	}
	return row
}

func contains(values []string, value string) bool {
	for _, candidate := range values {
		if candidate == value {
			return true
		}
	}
	return false
}
