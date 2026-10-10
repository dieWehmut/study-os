package httpapi

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"study-os/backend/app"
	"study-os/backend/models"
)

// How many rows one page of the export reads before asking for the next.
//
// The list endpoint caps a page at 500 and the library is small enough to hold,
// but the export still pages rather than asking for "everything": a limit that
// silently truncates would hand someone a file that looks complete and is not.
const exportPageSize = 500

// exportColumns is the importer's vocabulary, in its order.
//
// The two ends have to agree on the names or the round trip fails in the quiet
// way: a spreadsheet edited in between comes back with nothing mapped, and
// nothing about the file says so. `wiki` is the importer's name for what the
// model calls DetailedMarkdown.
var exportColumns = []string{
	"term", "definition", "item_type", "part_of_speech", "pronunciation",
	"example", "wiki", "level", "subject", "tags",
}

func exportRow(item models.KnowledgeItem) []string {
	return []string{
		item.Term,
		item.ConciseDefinition,
		item.ItemType,
		item.PartOfSpeech,
		item.Pronunciation,
		item.Example,
		item.DetailedMarkdown,
		item.Level,
		item.Subject,
		strings.Join(item.Tags, " "),
	}
}

func exportObject(item models.KnowledgeItem) map[string]any {
	row := map[string]any{}
	for index, column := range exportColumns {
		row[column] = exportRow(item)[index]
	}
	// Not read back by the importer, but a file of the reader's own notes should
	// say when each one was written and which item it was.
	row["id"] = item.ID
	row["created_at"] = item.CreatedAt.UTC().Format(time.RFC3339)
	return row
}

// handleKnowledgeExport writes the library out in the format 导入 reads.
//
// Every intake in this app ends up in 知识库 and none of them could leave it: the
// data was reachable only through the SQLite file. Exporting in the importer's
// own column names makes the pair a loop rather than two unrelated features --
// edit a few rows in a spreadsheet, import them back, let the merge review sort
// out what changed.
func handleKnowledgeExport(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	format := strings.ToLower(strings.TrimSpace(request.URL.Query().Get("format")))
	if format == "" {
		format = "csv"
	}
	if format != "csv" && format != "jsonl" {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "format 只支持 csv 或 jsonl"})
		return
	}
	scheduledFilter, ok := parseScheduledFilter(request.URL.Query().Get("scheduled"))
	if !ok {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "scheduled must be yes or no"})
		return
	}
	options := models.KnowledgeListOptions{
		Query:     request.URL.Query().Get("q"),
		Subject:   request.URL.Query().Get("subject"),
		Tag:       request.URL.Query().Get("tag"),
		Scheduled: scheduledFilter,
		Limit:     exportPageSize,
	}
	// 知识分组 is a filter the list can be narrowed by, and an export that ignored
	// it would hand someone the whole library while they are looking at one group
	// -- the same mistake the search box made until it was wired through.
	groupID := strings.TrimSpace(request.URL.Query().Get("group"))
	readPage := func(offset int) ([]models.KnowledgeItem, error) {
		if groupID != "" {
			groupOptions := models.KnowledgeListOptions{Scheduled: scheduledFilter, Limit: exportPageSize, Offset: offset}
			return application.Store.ListItemsByGroup(request.Context(), groupID, groupOptions)
		}
		options.Offset = offset
		return application.Store.ListKnowledgeItems(request.Context(), options)
	}

	// The reader is about to save this, so it is not JSON and it is not rendered
	// in a tab. The name carries the day: two exports in one afternoon are the
	// normal case for someone checking what changed.
	extension := format
	contentType := "text/csv; charset=utf-8"
	if format == "jsonl" {
		contentType = "application/x-ndjson; charset=utf-8"
	}
	response.Header().Set("Content-Type", contentType)
	response.Header().Set("Content-Disposition", fmt.Sprintf(
		`attachment; filename="study-os-knowledge-%s.%s"`,
		time.Now().UTC().Format("20060102"), extension,
	))

	// A CSV writer buffers and reports a bad line at the Write that produced it,
	// which is what is checked below; a failure that only shows up when the buffer is
	// pushed out cannot be reported at all -- the status and part of the file are
	// already on the wire. Stopping there leaves a file that is visibly short, which
	// is the most a streamed export can promise.
	var writer *csv.Writer
	if format == "csv" {
		writer = csv.NewWriter(response)
		if err := writer.Write(exportColumns); err != nil {
			return
		}
	}
	encoder := json.NewEncoder(response)

	for offset := 0; ; offset += exportPageSize {
		items, err := readPage(offset)
		if err != nil {
			// Nothing useful can be said in the middle of a file; stop here and
			// let the short file be visibly short.
			return
		}
		for _, item := range items {
			if writer != nil {
				if err := writer.Write(exportRow(item)); err != nil {
					return
				}
				continue
			}
			if err := encoder.Encode(exportObject(item)); err != nil {
				return
			}
		}
		if len(items) < exportPageSize {
			break
		}
	}
	if writer != nil {
		writer.Flush()
	}
}
