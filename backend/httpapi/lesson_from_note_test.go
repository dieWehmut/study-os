package httpapi_test

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"study-os/backend/config"
	"study-os/backend/httpapi"
)

// 课程 was reachable only through POST /api/lessons, which no screen called: the
// 课程 page told you to 去整合资料 and the 整合 page had no way to hand a note over.
// A lesson made from a note references it, and the server turns the note's cards
// and map into the two sections they can answer.
func TestLessonCreatedFromAnIntegratedNoteFillsWhatTheNoteHolds(t *testing.T) {
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)

	noteResponse := requestJSON(t, router, http.MethodPost, "/api/integrate", map[string]any{
		"subject": "physics",
		"title":   "受力分析",
		"text":    "合力等于质量乘以加速度。先画受力图，再分解。",
	})
	if noteResponse.Code != http.StatusCreated {
		t.Fatalf("integrate = %d, body = %s", noteResponse.Code, noteResponse.Body.String())
	}
	var note struct {
		ID string `json:"id"`
	}
	decodeJSON(t, noteResponse, &note)

	lessonResponse := requestJSON(t, router, http.MethodPost, "/api/lessons", map[string]any{
		"subject":     "physics",
		"title":       "受力分析",
		"source_type": "integrated_note",
		"source_id":   note.ID,
	})
	if lessonResponse.Code != http.StatusCreated {
		t.Fatalf("create lesson = %d, body = %s", lessonResponse.Code, lessonResponse.Body.String())
	}
	var lesson struct {
		ID       string `json:"id"`
		Document struct {
			Sections []struct {
				Type    string          `json:"type"`
				Content json.RawMessage `json:"content"`
			} `json:"sections"`
		} `json:"document"`
	}
	decodeJSON(t, lessonResponse, &lesson)
	if len(lesson.Document.Sections) != 10 {
		t.Fatalf("sections = %d, want the ten-section template", len(lesson.Document.Sections))
	}

	section := func(sectionType string) string {
		for _, candidate := range lesson.Document.Sections {
			if candidate.Type == sectionType {
				return string(candidate.Content)
			}
		}
		return ""
	}

	concept := section("concept")
	if !strings.Contains(concept, "受力") && !strings.Contains(concept, "合力") {
		t.Fatalf("concept section = %s, want the note's cards", concept)
	}
	if !strings.Contains(concept, `"items"`) {
		t.Fatalf("concept section = %s, want items the lesson page can list", concept)
	}
	// A body that opens with its own title is not repeated: 速度：速度描述… stutters.
	if strings.Count(concept, "合力等于质量乘以加速度") != 1 {
		t.Fatalf("concept section repeats a title: %s", concept)
	}
	visualization := section("visualization")
	if !strings.Contains(visualization, `"markdown"`) || !strings.Contains(visualization, "- ") {
		t.Fatalf("visualization section = %s, want the map as an outline", visualization)
	}
	// The rest is the empty template, not invented content.
	if got := section("summary"); got != "{}" {
		t.Fatalf("summary section = %s, want the empty template", got)
	}

	// A note that is gone leaves a usable draft rather than a 500.
	orphan := requestJSON(t, router, http.MethodPost, "/api/lessons", map[string]any{
		"subject": "physics", "title": "少了来源",
		"source_type": "integrated_note", "source_id": "note-that-never-existed",
	})
	if orphan.Code != http.StatusCreated {
		t.Fatalf("orphan lesson = %d, body = %s", orphan.Code, orphan.Body.String())
	}
}