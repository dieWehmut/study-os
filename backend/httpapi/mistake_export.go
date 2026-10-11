package httpapi

import (
	"encoding/csv"
	"fmt"
	"net/http"
	"strings"
	"time"

	"study-os/backend/app"
	"study-os/backend/models"
)

// The 错题本 as a table: what was asked, why it went wrong, and what fixed it.
//
// This is the last of the three exports (知识库 CSV, 课程 Markdown) and the one a
// tutor or a parent is most likely to be handed, so it is written for a person
// to read rather than for this app to read back: full words in the headings,
// the 错因 as the app labels it, and the diagnosis evidence as JSON text.
var mistakeExportColumns = []string{
	"题干", "学科", "错因", "错因说明", "订正答案", "订正用时(毫秒)", "已订正", "诊断证据", "关联知识点", "记录时间",
}

func mistakeExportRow(mistake models.Mistake, causeLabel string) []string {
	correction := mistake.Correction
	answer, elapsed := "", ""
	if correction != nil {
		answer = correction.Answer
		elapsed = fmt.Sprintf("%d", correction.ElapsedMS)
	}
	evidence := ""
	if raw := strings.TrimSpace(string(mistake.Attempt.EvidenceJSON)); raw != "" && raw != "{}" && raw != "[]" && raw != "null" {
		// An empty object is how "no drawing was made" is stored; a spreadsheet
		// cell reading `{}` looks like data and is not.
		evidence = raw
	}
	return []string{
		mistake.Question.Stem,
		mistake.Question.Subject,
		causeLabel,
		mistake.Attempt.Note,
		answer,
		elapsed,
		map[bool]string{true: "是", false: "否"}[mistake.Corrected],
		evidence,
		mistake.Question.KnowledgeItemID,
		mistake.Question.CreatedAt.UTC().Format(time.RFC3339),
	}
}

func handleMistakeExport(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	subject := strings.ToLower(strings.TrimSpace(request.URL.Query().Get("subject")))
	// Every status: a 错题 may name a cause that was later retired, and a file that
	// silently dropped the label would leave those rows with an id in them.
	causes, err := application.Store.ListErrorCauses(request.Context(), models.ErrorCauseListOptions{
		Subject: subject,
		Status:  models.ErrorCauseStatusAll,
		Limit:   500,
	})
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "读取错因失败"})
		return
	}
	// The same taxonomy the page shows, so the file says 思路不对 rather than the
	// id behind it.
	labels := make(map[string]string, len(causes))
	for _, cause := range causes {
		labels[cause.ID] = cause.Label
	}

	response.Header().Set("Content-Type", "text/csv; charset=utf-8")
	response.Header().Set("Content-Disposition", fmt.Sprintf(
		`attachment; filename="study-os-错题-%s.csv"`, time.Now().UTC().Format("20060102"),
	))
	writer := csv.NewWriter(response)
	if err := writer.Write(mistakeExportColumns); err != nil {
		return
	}
	options := models.MistakeListOptions{
		Subject: subject,
		// The search box narrows the list; the file has to mean the same thing as
		// the list, or the reader exports "everything" while looking at three rows.
		Query: strings.TrimSpace(request.URL.Query().Get("q")),
		// Same for 错因: it is a filter on screen, so it is a filter in the file.
		Cause: strings.TrimSpace(request.URL.Query().Get("cause")),
		// And 订正 state, for the same reason: exporting while looking at "还没订正"
		// must not hand over the ones that were fixed.
		Corrected: strings.ToLower(strings.TrimSpace(request.URL.Query().Get("corrected"))),
		Limit:     exportPageSize,
	}
	for offset := 0; ; offset += exportPageSize {
		options.Offset = offset
		mistakes, err := application.Store.ListMistakes(request.Context(), options)
		if err != nil {
			// Mid-file, so the answer is partly written; stopping leaves a file
			// that is visibly short rather than one that looks complete.
			return
		}
		for _, mistake := range mistakes {
			label := labels[mistake.Attempt.Cause]
			if label == "" {
				label = mistake.Attempt.Cause
			}
			if err := writer.Write(mistakeExportRow(mistake, label)); err != nil {
				return
			}
		}
		if len(mistakes) < exportPageSize {
			break
		}
	}
	writer.Flush()
}
