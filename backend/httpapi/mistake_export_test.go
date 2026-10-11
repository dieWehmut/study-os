package httpapi_test

import (
	"context"
	"encoding/csv"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"study-os/backend/config"
	"study-os/backend/httpapi"
	"study-os/backend/models"
)

func mistakeExport(t *testing.T, router http.Handler, query string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(http.MethodGet, "/api/mistakes/export"+query, nil)
	request.Host = "127.0.0.1:8080"
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	return recorder
}

// The 错题本 is the export most likely to be handed to someone else, so it is
// written for a person: full-word headings, the cause as the page labels it, and
// the 订正 as its own column rather than folded into the note.
func TestMistakeExportWritesAReadableRow(t *testing.T) {
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)
	ctx := context.Background()

	filed, err := application.Store.RecordMistake(ctx, models.MistakeInput{
		Subject: "physics", Stem: "斜面上的木块受力", Cause: "method",
		Note: "先列接触力", Answer: "只画了重力",
	})
	if err != nil {
		t.Fatalf("record mistake: %v", err)
	}
	if _, err := application.Store.RecordMistakeCorrection(ctx, filed.Attempt.ID, models.MistakeCorrectionInput{
		Answer: "支持力 10 N", ElapsedMS: 800,
	}); err != nil {
		t.Fatalf("record correction: %v", err)
	}

	exported := mistakeExport(t, router, "?subject=physics")
	if exported.Code != http.StatusOK {
		t.Fatalf("export = %d, body = %s", exported.Code, exported.Body.String())
	}
	if disposition := exported.Header().Get("Content-Disposition"); !strings.Contains(disposition, ".csv") {
		t.Fatalf("Content-Disposition = %q", disposition)
	}
	rows, err := csv.NewReader(strings.NewReader(exported.Body.String())).ReadAll()
	if err != nil {
		t.Fatalf("csv: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("rows = %d, want a header and one mistake: %q", len(rows), exported.Body.String())
	}
	header := map[string]int{}
	for index, column := range rows[0] {
		header[column] = index
	}
	for _, want := range []string{"题干", "错因", "订正答案", "已订正"} {
		if _, ok := header[want]; !ok {
			t.Fatalf("header %v has no %q", rows[0], want)
		}
	}
	row := rows[1]
	if row[header["题干"]] != "斜面上的木块受力" || row[header["错因"]] != "思路不对" {
		t.Fatalf("row = %v", row)
	}
	if row[header["订正答案"]] != "支持力 10 N" || row[header["订正用时(毫秒)"]] != "800" {
		t.Fatalf("correction columns = %v", row)
	}
	if row[header["已订正"]] != "是" {
		t.Fatalf("corrected column = %q", row[header["已订正"]])
	}
	// No drawing was made, and an empty object in the cell would read as data.
	if row[header["诊断证据"]] != "" {
		t.Fatalf("evidence column = %q, want it empty", row[header["诊断证据"]])
	}

	// The same file narrowed to another subject is a header and nothing else.
	other := mistakeExport(t, router, "?subject=chemistry")
	if lines := strings.Count(strings.TrimSpace(other.Body.String()), "\n"); lines != 0 {
		t.Fatalf("chemistry export has %d data lines: %s", lines, other.Body.String())
	}
	// The search box narrows the list, so it has to narrow the file as well.
	searched := mistakeExport(t, router, "?q="+url.QueryEscape("木块"))
	if !strings.Contains(searched.Body.String(), "斜面上的木块受力") {
		t.Fatalf("search dropped the matching row: %s", searched.Body.String())
	}
	missed := mistakeExport(t, router, "?q="+url.QueryEscape("电磁感应"))
	if strings.Contains(missed.Body.String(), "斜面上的木块受力") {
		t.Fatalf("search did not narrow the file: %s", missed.Body.String())
	}
	// 错因 is a filter on screen, so it is a filter in the file: exporting while
	// looking at the method mistakes must not hand over every mistake.
	byCause := mistakeExport(t, router, "?cause=method")
	if !strings.Contains(byCause.Body.String(), "斜面上的木块受力") {
		t.Fatalf("cause filter dropped the matching row: %s", byCause.Body.String())
	}
	otherCause := mistakeExport(t, router, "?cause=misread")
	if strings.Contains(otherCause.Body.String(), "斜面上的木块受力") {
		t.Fatalf("cause filter did not narrow the file: %s", otherCause.Body.String())
	}
	// 订正 state narrows the file as well. This mistake was corrected above, so the
	// "still open" file must not contain it and the "fixed" one must.
	stillOpen := mistakeExport(t, router, "?corrected=no")
	if strings.Contains(stillOpen.Body.String(), "斜面上的木块受力") {
		t.Fatalf("corrected=no kept a corrected mistake: %s", stillOpen.Body.String())
	}
	fixed := mistakeExport(t, router, "?corrected=yes")
	if !strings.Contains(fixed.Body.String(), "斜面上的木块受力") {
		t.Fatalf("corrected=yes dropped a corrected mistake: %s", fixed.Body.String())
	}
}

func TestMistakeExportKeepsACauseItCannotName(t *testing.T) {
	// A cause the taxonomy no longer offers still labels the row it was filed
	// under: an id in a CSV column is not a 错因.
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)

	if _, err := application.Store.RecordMistake(context.Background(), models.MistakeInput{
		Subject: "math", Stem: "解方程", Cause: "retired_cause", OccurredAt: time.Now().UTC(),
	}); err != nil {
		t.Fatalf("record mistake: %v", err)
	}

	body := mistakeExport(t, router, "").Body.String()
	if !strings.Contains(body, "retired_cause") {
		t.Fatalf("retired cause is missing from %s", body)
	}
}
