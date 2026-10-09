package httpapi_test

import (
	"net/http"
	"testing"

	"study-os/backend/config"
	"study-os/backend/httpapi"
)

// The 关联对象 picker offers one page of the newest items, so the search box is
// the only way to reach an older one -- and that box used to look in the
// knowledge library alone. Mistakes and courses take the same `q` now, which is
// what makes the picker whole rather than half a search.
func TestMistakeListNarrowsByQuestionText(t *testing.T) {
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)

	for _, stem := range []string{"求函数 f(x)=x^3-3x 的极值", "光合作用的两个阶段答反了"} {
		created := requestJSON(t, router, http.MethodPost, "/api/mistakes", map[string]string{
			"subject": "math",
			"stem":    stem,
			"cause":   "method",
		})
		if created.Code != http.StatusCreated {
			t.Fatalf("create mistake = %d, body = %s", created.Code, created.Body.String())
		}
	}

	var all struct {
		Count int `json:"count"`
	}
	decodeJSON(t, requestJSON(t, router, http.MethodGet, "/api/mistakes?limit=50", nil), &all)
	if all.Count != 2 {
		t.Fatalf("unfiltered count = %d, want 2", all.Count)
	}

	var narrowed struct {
		Items []struct {
			Question struct {
				Stem string `json:"stem"`
			} `json:"question"`
		} `json:"items"`
		Count int `json:"count"`
	}
	decodeJSON(t, requestJSON(t, router, http.MethodGet, "/api/mistakes?q=极值", nil), &narrowed)
	if narrowed.Count != 1 {
		t.Fatalf("q=极值 count = %d, want 1", narrowed.Count)
	}
	if narrowed.Items[0].Question.Stem != "求函数 f(x)=x^3-3x 的极值" {
		t.Fatalf("q=极值 returned %q", narrowed.Items[0].Question.Stem)
	}

	var wildcards struct {
		Count int `json:"count"`
	}
	// `%` is a string, not a wildcard: the filter has to escape what the learner
	// typed or every query would match everything.
	decodeJSON(t, requestJSON(t, router, http.MethodGet, "/api/mistakes?q=%25", nil), &wildcards)
	if wildcards.Count != 0 {
		t.Fatalf("q=%% count = %d, want 0", wildcards.Count)
	}
}

func TestLessonListNarrowsByTitle(t *testing.T) {
	application := testApplication(t, config.Config{})
	router := httpapi.NewRouter(application)

	for _, title := range []string{"牛顿第二定律：从受力图开始", "光合作用的两阶段"} {
		created := requestJSON(t, router, http.MethodPost, "/api/lessons", map[string]string{
			"subject": "physics",
			"title":   title,
		})
		if created.Code != http.StatusCreated {
			t.Fatalf("create lesson = %d, body = %s", created.Code, created.Body.String())
		}
	}

	var narrowed struct {
		Items []struct {
			Title string `json:"title"`
		} `json:"items"`
		Count int `json:"count"`
	}
	decodeJSON(t, requestJSON(t, router, http.MethodGet, "/api/lessons?q=受力图", nil), &narrowed)
	if narrowed.Count != 1 {
		t.Fatalf("q=受力图 count = %d, want 1", narrowed.Count)
	}
	if narrowed.Items[0].Title != "牛顿第二定律：从受力图开始" {
		t.Fatalf("q=受力图 returned %q", narrowed.Items[0].Title)
	}
}