package selfupdate

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
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
		if got := CompareVersions(test.left, test.right); got != test.want {
			t.Fatalf("CompareVersions(%q, %q) = %d, want %d", test.left, test.right, got, test.want)
		}
	}
}

func TestNormalizeArchitectureMapsGoAndHostNames(t *testing.T) {
	cases := map[string]string{
		"amd64":   "x64",
		"x64":     "x64",
		"x86_64":  "x64",
		"AMD64":   "x64",
		"arm64":   "arm64",
		"ARM64":   "arm64",
		"aarch64": "arm64",
	}
	for input, want := range cases {
		if got := NormalizeArchitecture(input); got != want {
			t.Errorf("NormalizeArchitecture(%q) = %q, want %q", input, got, want)
		}
	}
	if got := NormalizeArchitecture(""); got == "" {
		t.Error("NormalizeArchitecture(\"\") did not fall back to the running process")
	}
}

// releaseFixture serves a manifest and its archives over HTTP so a check and an
// apply exercise the real fetch path.
type releaseFixture struct {
	server   *httptest.Server
	manifest Manifest
	archives map[string][]byte
}

func newReleaseFixture(t *testing.T, manifest Manifest, archives map[string][]byte) *releaseFixture {
	t.Helper()
	fixture := &releaseFixture{manifest: manifest, archives: archives}
	fixture.server = httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		name := filepath.Base(request.URL.Path)
		switch {
		case name == "manifest.json":
			_ = json.NewEncoder(response).Encode(fixture.manifest)
		case strings.HasSuffix(name, ".zip"):
			content, ok := fixture.archives[name]
			if !ok {
				http.NotFound(response, request)
				return
			}
			_, _ = response.Write(content)
		default:
			http.NotFound(response, request)
		}
	}))
	t.Cleanup(fixture.server.Close)
	return fixture
}

// desktopZip builds an archive shaped like the published desktop release.
func desktopZip(t *testing.T, entries map[string]string) []byte {
	t.Helper()
	var buffer strings.Builder
	writer := zip.NewWriter(&buffer)
	payload := map[string]string{"StudyOS.exe": "desktop executable"}
	for name, content := range entries {
		payload[name] = content
	}
	for name, content := range payload {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatalf("create entry %s: %v", name, err)
		}
		if _, err := entry.Write([]byte(content)); err != nil {
			t.Fatalf("write entry %s: %v", name, err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close archive: %v", err)
	}
	return []byte(buffer.String())
}

func sha256Hex(content []byte) string {
	sum := sha256.Sum256(content)
	return hex.EncodeToString(sum[:])
}

func desktopManifest(version string, archives map[string][]byte, base string) Manifest {
	manifest := Manifest{SchemaVersion: 1, Version: version}
	for _, arch := range []string{"x64", "arm64"} {
		name := fmt.Sprintf("study-os-%s-windows-%s.zip", version, arch)
		content, ok := archives[name]
		if !ok {
			continue
		}
		manifest.Assets = append(manifest.Assets, AssetEntry{
			OS:         "windows",
			Arch:       arch,
			URL:        base + "/" + name,
			SHA256:     sha256Hex(content),
			Size:       int64(len(content)),
			Entrypoint: "StudyOS.exe",
		})
	}
	return manifest
}

func newTestService(t *testing.T, fixture *releaseFixture, dataDir string) *Service {
	t.Helper()
	service := NewService(Options{
		Repo:         "fake/study-os",
		Version:      "0.2.0",
		DataDir:      dataDir,
		Architecture: "x64",
		InstallRoot:  dataDir,
		ManifestURL:  fixture.server.URL + "/releases/latest/download/manifest.json",
	})
	service.HTTPClient = fixture.server.Client()
	return service
}

func TestCheckFindsDesktopUpdateWhenRemoteIsNewer(t *testing.T) {
	archives := map[string][]byte{
		"study-os-0.3.0-windows-x64.zip": desktopZip(t, nil),
	}
	fixture := newReleaseFixture(t, Manifest{}, archives)
	fixture.manifest = desktopManifest("0.3.0", archives, fixture.server.URL+"/releases/download")

	service := newTestService(t, fixture, t.TempDir())
	status := service.Status(context.Background())
	if !status.UpdateAvailable {
		t.Fatalf("update not reported: %#v", status)
	}
	if status.LatestVersion != "0.3.0" {
		t.Fatalf("latest version = %q", status.LatestVersion)
	}
	if status.AssetName != "study-os-0.3.0-windows-x64.zip" {
		t.Fatalf("asset name = %q", status.AssetName)
	}
}

// A launcher package is not a desktop build. The retired PWA archive carries a
// server binary and a web directory but no desktop executable, so an update
// that offers one must be refused rather than installed as the desktop app.
func TestApplyRefusesTheRetiredPwaLauncherArchive(t *testing.T) {
	installRoot := t.TempDir()
	launcherPayload := zipWithEntrypoint(t, "study-os-server.exe")
	archives := map[string][]byte{"study-os-pwa-windows-x64.zip": launcherPayload}
	fixture := newReleaseFixture(t, Manifest{}, archives)
	fixture.manifest = Manifest{
		SchemaVersion: 1,
		Version:       "0.3.0",
		Assets: []AssetEntry{{
			OS:         "windows",
			Arch:       "x64",
			URL:        fixture.server.URL + "/releases/download/study-os-pwa-windows-x64.zip",
			SHA256:     sha256Hex(launcherPayload),
			Entrypoint: "study-os-server.exe",
		}},
	}

	service := newTestService(t, fixture, installRoot)
	if _, err := service.Apply(context.Background()); err == nil {
		t.Fatal("the retired PWA launcher archive was installed as the desktop app")
	}
	if _, err := os.Stat(filepath.Join(installRoot, "current.json")); !os.IsNotExist(err) {
		t.Fatal("current pointer was written for the retired launcher archive")
	}
}
func TestCheckDoesNotOfferAnOlderRelease(t *testing.T) {
	archives := map[string][]byte{
		"study-os-0.1.0-windows-x64.zip": desktopZip(t, nil),
	}
	fixture := newReleaseFixture(t, Manifest{}, archives)
	fixture.manifest = desktopManifest("0.1.0", archives, fixture.server.URL+"/releases/download")

	service := newTestService(t, fixture, t.TempDir())
	if status := service.Status(context.Background()); status.UpdateAvailable {
		t.Fatalf("older release offered as an update: %#v", status)
	}
}

func TestCheckReportsAMissingAssetForThisArchitecture(t *testing.T) {
	archives := map[string][]byte{
		"study-os-0.3.0-windows-arm64.zip": desktopZip(t, nil),
	}
	fixture := newReleaseFixture(t, Manifest{}, archives)
	fixture.manifest = desktopManifest("0.3.0", archives, fixture.server.URL+"/releases/download")

	// The service is x64 while the release only published arm64.
	service := newTestService(t, fixture, t.TempDir())
	status := service.Status(context.Background())
	if status.UpdateAvailable {
		t.Fatalf("update reported without an x64 asset: %#v", status)
	}
	if status.Error == "" {
		t.Fatal("missing asset did not report an error")
	}
}

func TestUpdateCheckGivesUpOnAStalledServer(t *testing.T) {
	// Status holds the mutex across the network call, and Mutex.Lock ignores
	// contexts, so a stalled check would wedge every later caller. The timeout
	// has to live in the service, not in the caller's context.
	previous := defaultUpdateTimeout
	defaultUpdateTimeout = 100 * time.Millisecond
	t.Cleanup(func() { defaultUpdateTimeout = previous })

	release := make(chan struct{})
	stalled := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		<-release
	}))
	t.Cleanup(stalled.Close)
	t.Cleanup(func() { close(release) })

	service := NewService(Options{
		Repo: "fake/study-os", Version: "0.2.0", DataDir: t.TempDir(),
		Architecture: "x64", ManifestURL: stalled.URL + "/releases/latest/download/manifest.json",
	})

	// context.Background on purpose: the service must bound itself rather than
	// lean on whatever deadline its caller happened to pass in.
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

	second := make(chan Status, 1)
	go func() { second <- service.Status(context.Background()) }()
	select {
	case <-second:
	case <-time.After(5 * time.Second):
		t.Fatal("a later update check is stuck behind the stalled one's mutex")
	}
}

func TestApplyStagesTheNewVersionAndFlipsThePointer(t *testing.T) {
	installRoot := t.TempDir()
	oldVersionDir := filepath.Join(installRoot, "versions", "0.2.0")
	if err := os.MkdirAll(oldVersionDir, 0o755); err != nil {
		t.Fatalf("mkdir old version: %v", err)
	}
	if err := WriteCurrentPointer(installRoot, "0.2.0", oldVersionDir, "StudyOS.exe"); err != nil {
		t.Fatalf("write pointer: %v", err)
	}

	archives := map[string][]byte{
		"study-os-0.3.0-windows-x64.zip": desktopZip(t, map[string]string{"LICENSE.txt": "terms"}),
	}
	fixture := newReleaseFixture(t, Manifest{}, archives)
	fixture.manifest = desktopManifest("0.3.0", archives, fixture.server.URL+"/releases/download")

	service := newTestService(t, fixture, installRoot)
	staged := false
	service.OnStaged = func() { staged = true }

	status, err := service.Apply(context.Background())
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	if status.LatestVersion != "0.3.0" {
		t.Fatalf("status = %#v", status)
	}
	if !staged {
		t.Fatal("staging did not ask the app to restart")
	}

	installed := filepath.Join(installRoot, "versions", "0.3.0", "StudyOS.exe")
	if _, err := os.Stat(installed); err != nil {
		t.Fatalf("staged executable missing: %v", err)
	}
	if _, err := os.Stat(filepath.Join(installRoot, "versions", "0.3.0", "LICENSE.txt")); err != nil {
		t.Fatalf("staged archive payload incomplete: %v", err)
	}
	pointer := readPointer(t, installRoot)
	if pointer.Version != "0.3.0" {
		t.Fatalf("current pointer version = %q", pointer.Version)
	}
	if pointer.Path != filepath.Join(installRoot, "versions", "0.3.0") {
		t.Fatalf("current pointer path = %q", pointer.Path)
	}
	if _, err := os.Stat(filepath.Join(installRoot, "restart.cmd")); err != nil {
		t.Fatalf("restart script missing: %v", err)
	}
}

func readPointer(t *testing.T, installRoot string) pointer {
	t.Helper()
	content, err := os.ReadFile(filepath.Join(installRoot, "current.json"))
	if err != nil {
		t.Fatalf("read pointer: %v", err)
	}
	var value pointer
	if err := json.Unmarshal(content, &value); err != nil {
		t.Fatalf("decode pointer: %v", err)
	}
	return value
}

func TestApplyRejectsAnArchiveWithoutTheDesktopExecutable(t *testing.T) {
	installRoot := t.TempDir()
	// A launcher-style archive: a server binary and a web directory, but no
	// desktop executable. It must not be installed as a desktop build.
	content := zipWithEntrypoint(t, "server/study-os-server.exe")
	archives := map[string][]byte{"study-os-0.3.0-windows-x64.zip": content}
	fixture := newReleaseFixture(t, Manifest{}, archives)
	fixture.manifest = desktopManifest("0.3.0", archives, fixture.server.URL+"/releases/download")

	service := newTestService(t, fixture, installRoot)
	if _, err := service.Apply(context.Background()); err == nil {
		t.Fatal("archive without the desktop executable was accepted")
	}
	if _, err := os.Stat(filepath.Join(installRoot, "current.json")); !os.IsNotExist(err) {
		t.Fatal("current pointer was written for a rejected archive")
	}
}

func zipWithEntrypoint(t *testing.T, entryName string) []byte {
	t.Helper()
	var buffer strings.Builder
	writer := zip.NewWriter(&buffer)
	entry, err := writer.Create(entryName)
	if err != nil {
		t.Fatalf("create entry: %v", err)
	}
	if _, err := entry.Write([]byte("payload")); err != nil {
		t.Fatalf("write entry: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close archive: %v", err)
	}
	return []byte(buffer.String())
}

func TestApplyRejectsBadChecksum(t *testing.T) {
	installRoot := t.TempDir()
	archives := map[string][]byte{"study-os-0.3.0-windows-x64.zip": desktopZip(t, nil)}
	fixture := newReleaseFixture(t, Manifest{}, archives)
	fixture.manifest = desktopManifest("0.3.0", archives, fixture.server.URL+"/releases/download")
	fixture.manifest.Assets[0].SHA256 = strings.Repeat("0", 64)

	service := newTestService(t, fixture, installRoot)
	if _, err := service.Apply(context.Background()); err == nil || !strings.Contains(err.Error(), "校验失败") {
		t.Fatalf("apply error = %v, want checksum failure", err)
	}
	if _, err := os.Stat(filepath.Join(installRoot, "current.json")); !os.IsNotExist(err) {
		t.Fatal("current pointer was written after a failed checksum")
	}
}

func TestApplyRefusesAnArchiveEntryThatEscapesTheInstallRoot(t *testing.T) {
	installRoot := t.TempDir()
	archives := map[string][]byte{"study-os-0.3.0-windows-x64.zip": desktopZip(t, map[string]string{"../escape.exe": "escape"})}
	fixture := newReleaseFixture(t, Manifest{}, archives)
	fixture.manifest = desktopManifest("0.3.0", archives, fixture.server.URL+"/releases/download")

	service := newTestService(t, fixture, installRoot)
	if _, err := service.Apply(context.Background()); err == nil {
		t.Fatal("archive entry escaping the install root was accepted")
	}
	if _, err := os.Stat(filepath.Join(installRoot, "escape.exe")); !os.IsNotExist(err) {
		t.Fatal("archive entry escaped the extraction directory")
	}
}

func TestApplyRefusesWhenNoUpdateIsAvailable(t *testing.T) {
	archives := map[string][]byte{"study-os-0.2.0-windows-x64.zip": desktopZip(t, nil)}
	fixture := newReleaseFixture(t, Manifest{}, archives)
	fixture.manifest = desktopManifest("0.2.0", archives, fixture.server.URL+"/releases/download")

	service := newTestService(t, fixture, t.TempDir())
	if _, err := service.Apply(context.Background()); err == nil {
		t.Fatal("apply succeeded without an available update")
	}
}

func TestApplyRefusesAPortableInstall(t *testing.T) {
	archives := map[string][]byte{"study-os-0.3.0-windows-x64.zip": desktopZip(t, nil)}
	fixture := newReleaseFixture(t, Manifest{}, archives)
	fixture.manifest = desktopManifest("0.3.0", archives, fixture.server.URL+"/releases/download")

	service := newTestService(t, fixture, t.TempDir())
	// A portable build has no managed install root, so its update must refuse
	// rather than overwrite a directory the installer does not own.
	service.InstallRoot = ""
	if _, err := service.Apply(context.Background()); err == nil {
		t.Fatal("portable install was allowed to self-update")
	}
}

func TestInstalledRootRecognizesTheManagedLayout(t *testing.T) {
	managed := filepath.Join("C:", "Users", "learner", "AppData", "Local", "StudyOS", "versions", "0.2.0", "StudyOS.exe")
	root, ok := InstalledRoot(managed)
	if !ok {
		t.Fatalf("managed layout not recognized: %q", managed)
	}
	want := filepath.Join("C:", "Users", "learner", "AppData", "Local", "StudyOS")
	if root != want {
		t.Fatalf("install root = %q, want %q", root, want)
	}

	for _, portable := range []string{
		filepath.Join("C:", "Users", "learner", "Desktop", "StudyOS.exe"),
		filepath.Join("D:", "build", "bin", "StudyOS.exe"),
		"",
	} {
		if _, ok := InstalledRoot(portable); ok {
			t.Errorf("portable path treated as managed: %q", portable)
		}
	}
}

func TestResolveAssetLocationHonoursHTTPSAndRelativeReferences(t *testing.T) {
	location := "https://example.test/repo/releases/latest/download/manifest.json"
	absolute := "https://example.test/repo/releases/download/study-os-0.3.0-windows-x64.zip"
	resolved, err := resolveAssetLocation(location, absolute)
	if err != nil || resolved != absolute {
		t.Fatalf("absolute asset resolved to %q (%v)", resolved, err)
	}

	resolved, err = resolveAssetLocation(location, "study-os-0.3.0-windows-x64.zip")
	if err != nil {
		t.Fatalf("relative asset: %v", err)
	}
	want := "https://example.test/repo/releases/download/study-os-0.3.0-windows-x64.zip"
	if resolved != want {
		t.Fatalf("relative asset resolved to %q, want %q", resolved, want)
	}

	if _, err := resolveAssetLocation(location, "http://example.test/release.zip"); err == nil {
		t.Fatal("plain HTTP asset was accepted")
	}
}
