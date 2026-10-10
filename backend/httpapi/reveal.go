package httpapi

import (
	"errors"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"

	"study-os/backend/app"
)

// errRevealRefused is what a test's stubbed launcher fails with.
var errRevealRefused = errors.New("reveal refused")

// revealCommand is the platform's "show me this folder" invocation.
//
// Split out from the run because it is the half that can be reasoned about
// without a desktop: the other half starts a file manager.
func revealCommand(goos, directory string) (string, []string) {
	switch goos {
	case "windows":
		return "explorer", []string{directory}
	case "darwin":
		return "open", []string{directory}
	default:
		return "xdg-open", []string{directory}
	}
}

// startReveal is a variable so a test can watch what would have been opened.
//
// The process is started and *not* waited for: explorer.exe exits non-zero even
// when it opened the window, so its exit status says nothing about success.
var startReveal = func(directory string) error {
	name, args := revealCommand(runtime.GOOS, directory)
	return exec.Command(name, args...).Start()
}

// handleSystemReveal opens the data directory in the file manager.
//
// The path is not a parameter. The only directory this can open is the one the
// settings page already shows -- so there is no request field to point anywhere
// else -- and the reason it exists is the promise that page makes: 学习记录默认
// 留在当前设备. Saying so is one thing; being able to go and look at the files is
// what makes it true.
func handleSystemReveal(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	directory, err := filepath.Abs(filepath.Clean(application.Config.DataDir))
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "数据目录不可用"})
		return
	}
	// Checked before opening: a data directory that was deleted or moved should
	// say so, rather than leaving the file manager on an error dialog of its own.
	info, err := os.Stat(directory)
	if err != nil || !info.IsDir() {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "数据目录不存在"})
		return
	}
	if err := startReveal(directory); err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "无法打开数据目录"})
		return
	}
	writeJSON(response, http.StatusOK, map[string]string{"status": "opened", "directory": directory})
}
