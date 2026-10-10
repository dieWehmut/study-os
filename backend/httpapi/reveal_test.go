package httpapi_test

import (
	"net/http"
	"path/filepath"
	"testing"

	"study-os/backend/config"
	"study-os/backend/httpapi"
)

// The data directory is the promise 设置页 makes ("学习记录默认留在当前设备").
// Opening it is what lets a reader check that, and it takes no path from the
// request -- there is nothing to point at a directory that is not this one.
func TestRevealOpensTheConfiguredDataDirectory(t *testing.T) {
	restore := httpapi.StubRevealForTest(t)
	application := testApplication(t, config.Config{DataDir: t.TempDir()})
	router := httpapi.NewRouter(application)

	response := requestJSON(t, router, http.MethodPost, "/api/system/reveal", nil)
	if response.Code != http.StatusOK {
		t.Fatalf("reveal = %d, body = %s", response.Code, response.Body.String())
	}
	want, err := filepath.Abs(application.Config.DataDir)
	if err != nil {
		t.Fatalf("abs data dir: %v", err)
	}
	if len(restore.Opened) != 1 || restore.Opened[0] != want {
		t.Fatalf("opened %v, want [%s]", restore.Opened, want)
	}
}

func TestRevealSaysSoWhenTheDirectoryIsGone(t *testing.T) {
	// A deleted or moved data directory has to be reported here: handing it to
	// the file manager would leave the reader with that program's error instead.
	//
	// The path is reassigned rather than deleted: the application keeps its
	// SQLite file open inside the real one, and on Windows that directory cannot
	// be removed while it is.
	restore := httpapi.StubRevealForTest(t)
	application := testApplication(t, config.Config{DataDir: t.TempDir()})
	application.Config.DataDir = filepath.Join(t.TempDir(), "gone")
	router := httpapi.NewRouter(application)

	response := requestJSON(t, router, http.MethodPost, "/api/system/reveal", nil)
	if response.Code != http.StatusInternalServerError {
		t.Fatalf("reveal = %d, want 500; body = %s", response.Code, response.Body.String())
	}
	if len(restore.Opened) != 0 {
		t.Fatalf("opened %v, want nothing opened", restore.Opened)
	}
}

func TestRevealReportsAFileManagerThatWillNotStart(t *testing.T) {
	restore := httpapi.StubRevealForTest(t)
	restore.Fail = true
	application := testApplication(t, config.Config{DataDir: t.TempDir()})
	router := httpapi.NewRouter(application)

	response := requestJSON(t, router, http.MethodPost, "/api/system/reveal", nil)
	if response.Code != http.StatusInternalServerError {
		t.Fatalf("reveal = %d, want 500; body = %s", response.Code, response.Body.String())
	}
}

func TestRevealCommandPerPlatform(t *testing.T) {
	for _, testCase := range []struct {
		goos string
		want string
	}{
		{goos: "windows", want: "explorer"},
		{goos: "darwin", want: "open"},
		{goos: "linux", want: "xdg-open"},
	} {
		name, args := httpapi.RevealCommandForTest(testCase.goos, "C:/data")
		if name != testCase.want {
			t.Errorf("%s: command = %q, want %q", testCase.goos, name, testCase.want)
		}
		if len(args) != 1 || args[0] != "C:/data" {
			t.Errorf("%s: args = %v, want the directory alone", testCase.goos, args)
		}
	}
}
