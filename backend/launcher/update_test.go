package launcher

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestCompareVersions(t *testing.T) {
	tests := []struct {
		left, right string
		want        int
	}{
		{"0.2.0", "0.3.0", -1},
		{"0.3.0", "0.2.0", 1},
		{"0.2.0", "0.2.0", 0},
		{"0.2.0-dev", "0.2.0", 0},
		{"0.10.0", "0.9.9", 1},
		{"v1.0.0", "0.9.0", 1},
	}
	for _, test := range tests {
		if got := compareVersions(test.left, test.right); got != test.want {
			t.Fatalf("compareVersions(%q, %q) = %d, want %d", test.left, test.right, got, test.want)
		}
	}
}

func releaseHandler(t *testing.T, version string, withAsset bool) http.HandlerFunc {
	return func(response http.ResponseWriter, request *http.Request) {
		t.Logf("release handler path = %q", request.URL.Path)
		if request.URL.Path != "/repos/fake/study-os/releases/latest" {
			http.NotFound(response, request)
			return
		}
		assets := "[]"
		if withAsset {
			assets = `[{"name":"study-os-pwa-windows-x64.zip","browser_download_url":"/download"}]`
		}
		_, _ = response.Write([]byte(fmt.Sprintf(
			`{"tag_name":"v%s","body":"更新说明","html_url":"https://example.test/release",`+
				`"assets":%s}`, version, assets)))
	}
}

func TestCheckFindsUpdateWhenRemoteIsNewer(t *testing.T) {
	server := httptest.NewServer(releaseHandler(t, "0.3.0", true))
	defer server.Close()
	service := NewService(Options{Repo: "fake/study-os", Version: "0.2.0-dev", DataDir: t.TempDir()})
	service.HTTPClient = server.Client()
	service.APIBase = server.URL
	if service.HTTPClient == http.DefaultClient {
		t.Fatal("HTTP client was not replaced")
	}
	probe, err := service.HTTPClient.Get(server.URL + "/repos/fake/study-os/releases/latest")
	if err != nil {
		t.Fatalf("probe failed: %v", err)
	}
	_ = probe.Body.Close()
	t.Logf("probe status = %d", probe.StatusCode)

	status := service.Status(context.Background())
	if !status.UpdateAvailable {
		t.Fatalf("status = %#v, want update available", status)
	}
	if status.LatestVersion != "0.3.0" || status.AssetName != "study-os-pwa-windows-x64.zip" {
		t.Fatalf("status = %#v", status)
	}
	if !strings.Contains(status.ReleaseNotes, "更新说明") {
		t.Fatalf("release notes = %q", status.ReleaseNotes)
	}
}

func TestCheckNoUpdateWhenVersionMatches(t *testing.T) {
	server := httptest.NewServer(releaseHandler(t, "0.2.0", true))
	defer server.Close()
	service := NewService(Options{Repo: "fake/study-os", Version: "0.2.0", DataDir: t.TempDir()})
	service.HTTPClient = server.Client()
	service.APIBase = server.URL

	if service.Status(context.Background()).UpdateAvailable {
		t.Fatal("same version must not be reported as an update")
	}
}

func makeZip(t *testing.T, destination string) {
	t.Helper()
	file, err := os.Create(destination)
	if err != nil {
		t.Fatalf("create zip: %v", err)
	}
	writer := zip.NewWriter(file)
	entries := map[string]string{
		"study-os-server.exe": "fake-binary",
		"web/index.html":      "<html>学习系统</html>",
	}
	for name, content := range entries {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatalf("create zip entry: %v", err)
		}
		if _, err := entry.Write([]byte(content)); err != nil {
			t.Fatalf("write zip entry: %v", err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close zip: %v", err)
	}
	_ = file.Close()
}

func TestApplyStagesVerifiedRelease(t *testing.T) {
	dataDir := t.TempDir()
	zipPath := filepath.Join(dataDir, "update-tmp", "release.zip")
	if err := os.MkdirAll(filepath.Dir(zipPath), 0o700); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	makeZip(t, zipPath)
	sum := sha256.Sum256(mustRead(t, zipPath))
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch {
		case request.URL.Path == "/repos/fake/study-os/releases/latest":
			_, _ = response.Write([]byte(`{"tag_name":"v0.3.0","body":"更新说明","assets":[{"name":"study-os-pwa-windows-x64.zip","browser_download_url":"/download"}]}`))
		case request.URL.Path == "/releases/download/v0.3.0/study-os-pwa-windows-x64.zip":
			http.ServeFile(response, request, zipPath)
		case request.URL.Path == "/releases/download/v0.3.0/study-os-pwa-windows-x64.zip.sha256":
			_, _ = response.Write([]byte(hex.EncodeToString(sum[:]) + "  study-os-pwa-windows-x64.zip\n"))
		default:
			http.NotFound(response, request)
		}
	}))
	defer server.Close()

	service := NewService(Options{Repo: "fake/study-os", Version: "0.2.0", DataDir: dataDir})
	service.HTTPClient = server.Client()
	service.DownloadBase = server.URL
	service.APIBase = server.URL

	status, err := service.Apply(context.Background())
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	if status.LatestVersion != "0.3.0" {
		t.Fatalf("status = %#v", status)
	}
	exe := filepath.Join(dataDir, "update-staging", "0.3.0", "study-os-server.exe")
	index := filepath.Join(dataDir, "update-staging", "0.3.0", "web", "index.html")
	if _, err := os.Stat(exe); err != nil {
		t.Fatalf("staged exe missing: %v", err)
	}
	if _, err := os.Stat(index); err != nil {
		t.Fatalf("staged web missing: %v", err)
	}
	script, err := os.ReadFile(filepath.Join(dataDir, "restart.cmd"))
	if err != nil {
		t.Fatalf("restart script missing: %v", err)
	}
	if !strings.Contains(string(script), "0.3.0") {
		t.Fatalf("restart script missing version:\n%s", string(script))
	}
}

func TestApplyRejectsBadChecksum(t *testing.T) {
	dataDir := t.TempDir()
	zipPath := filepath.Join(dataDir, "update-tmp", "release.zip")
	if err := os.MkdirAll(filepath.Dir(zipPath), 0o700); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	makeZip(t, zipPath)
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch {
		case request.URL.Path == "/repos/fake/study-os/releases/latest":
			_, _ = response.Write([]byte(`{"tag_name":"v0.3.0","assets":[{"name":"study-os-pwa-windows-x64.zip","browser_download_url":"/download"}]}`))
		case strings.HasSuffix(request.URL.Path, ".zip"):
			http.ServeFile(response, request, zipPath)
		case strings.HasSuffix(request.URL.Path, ".zip.sha256"):
			_, _ = response.Write([]byte(strings.Repeat("0", 64) + "  study-os-pwa-windows-x64.zip\n"))
		default:
			http.NotFound(response, request)
		}
	}))
	defer server.Close()
	service := NewService(Options{Repo: "fake/study-os", Version: "0.2.0", DataDir: dataDir})
	service.HTTPClient = server.Client()
	service.DownloadBase = server.URL
	service.APIBase = server.URL

	if _, err := service.Apply(context.Background()); err == nil || !strings.Contains(err.Error(), "校验失败") {
		t.Fatalf("apply error = %v, want checksum failure", err)
	}
	if _, err := os.Stat(filepath.Join(dataDir, "update-staging")); !os.IsNotExist(err) {
		t.Fatalf("staging must not exist after failed checksum")
	}
}

func mustRead(t *testing.T, path string) []byte {
	t.Helper()
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return content
}

func TestUpdateCheckGivesUpOnAStalledGitHub(t *testing.T) {
	// NewService hands the update checker http.DefaultClient, which has no
	// timeout. GitHub accepting the connection and then never answering is
	// indistinguishable from a healthy check until the client gives up, and it
	// never does.
	//
	// The damage is wider than the one stuck request. Status holds s.mu across
	// the network call, and sync.Mutex.Lock is not context-aware, so every later
	// caller blocks on the mutex no matter how short its own deadline is: one
	// stalled check wedges the update endpoint for the rest of the process.
	previous := defaultUpdateTimeout
	defaultUpdateTimeout = 100 * time.Millisecond
	t.Cleanup(func() { defaultUpdateTimeout = previous })

	release := make(chan struct{})
	stalled := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		<-release
	}))
	// httptest's Close waits for handlers to return, so the release has to
	// happen first. Cleanups run last-registered-first.
	t.Cleanup(stalled.Close)
	t.Cleanup(func() { close(release) })

	service := NewService(Options{Repo: "fake/study-os", Version: "0.2.0", DataDir: t.TempDir()})
	service.APIBase = stalled.URL

	// context.Background() on purpose: the service has to bound itself rather
	// than lean on whatever deadline the HTTP handler happened to pass in.
	done := make(chan Status, 1)
	go func() { done <- service.Status(context.Background()) }()
	select {
	case status := <-done:
		if status.Error == "" {
			t.Fatalf("stalled update server reported success: %#v", status)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Status never returned: the update check has no request timeout")
	}

	// The second caller is the one that matters: it proves the stalled check
	// released the mutex instead of wedging every future request behind it.
	second := make(chan Status, 1)
	go func() { second <- service.Status(context.Background()) }()
	select {
	case <-second:
	case <-time.After(5 * time.Second):
		t.Fatal("a later update check is stuck behind the stalled one's mutex")
	}
}
