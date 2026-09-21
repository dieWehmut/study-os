package selfupdate

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Status is the update view shown by the startup dialog and the settings page.
// The JSON names match what the frontend already reads.
type Status struct {
	CurrentVersion  string    `json:"current_version"`
	LatestVersion   string    `json:"latest_version,omitempty"`
	UpdateAvailable bool      `json:"update_available"`
	ReleaseURL      string    `json:"release_url,omitempty"`
	AssetName       string    `json:"asset_name,omitempty"`
	CheckedAt       time.Time `json:"checked_at"`
	Error           string    `json:"error,omitempty"`
}

// Options describes one machine's update channel and install.
type Options struct {
	Repo         string
	Version      string
	Architecture string
	InstallRoot  string
	ManifestURL  string
}

// Service checks the published release manifest and stages a newer desktop
// build. It owns no window and no server: the desktop app hosts it, so the
// update surface survives independently of the retired PWA launcher.
type Service struct {
	Repo        string
	Version     string
	AssetArch   string
	InstallRoot string
	ManifestURL string
	HTTPClient  *http.Client
	// OnStaged runs once a new build is staged. It is how the desktop app is
	// told to exit so the restart script can replace its executable.
	OnStaged func()

	mu       sync.Mutex
	cache    *Status
	cachedAt time.Time
}

// defaultUpdateTimeout bounds a single manifest lookup.
var defaultUpdateTimeout = 20 * time.Second

// AssetEntry is one published archive in the release manifest.
type AssetEntry struct {
	OS         string `json:"os"`
	Arch       string `json:"arch"`
	URL        string `json:"url"`
	SHA256     string `json:"sha256"`
	Size       int64  `json:"size"`
	Entrypoint string `json:"entrypoint"`
}

// Manifest mirrors the file scripts/package-release.ps1 publishes.
type Manifest struct {
	SchemaVersion int          `json:"schema_version"`
	Version       string       `json:"version"`
	PublishedAt   string       `json:"published_at"`
	Assets        []AssetEntry `json:"assets"`
}

// desktopEntrypoint is the executable inside the published desktop archive,
// matching the entrypoint scripts/package-release.ps1 writes into its manifest.
const desktopEntrypoint = "StudyOS.exe"

func NewService(options Options) *Service {
	service := &Service{
		Repo:        strings.TrimSpace(options.Repo),
		Version:     options.Version,
		AssetArch:   NormalizeArchitecture(options.Architecture),
		InstallRoot: strings.TrimSpace(options.InstallRoot),
		ManifestURL: strings.TrimSpace(options.ManifestURL),
		HTTPClient:  http.DefaultClient,
	}
	if service.Repo == "" {
		service.Repo = "dieWehmut/study-os"
	}
	return service
}

// NormalizeArchitecture maps GOARCH and the host architecture names onto the
// two names the release pipeline publishes.
func NormalizeArchitecture(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "":
		return normalizeGoArchitecture(runtime.GOARCH)
	case "amd64", "x64", "x86_64":
		return "x64"
	case "arm64", "aarch64":
		return "arm64"
	default:
		return strings.ToLower(strings.TrimSpace(value))
	}
}

func normalizeGoArchitecture(value string) string {
	if strings.EqualFold(value, "amd64") {
		return "x64"
	}
	return strings.ToLower(value)
}

// ManifestLocation is the release manifest this install follows. GitHub's
// /releases/latest/download/ alias always resolves to the newest release, so a
// check needs no API token and no rate-limit budget.
func (s *Service) ManifestLocation() string {
	if s.ManifestURL != "" {
		return s.ManifestURL
	}
	return "https://github.com/" + s.Repo + "/releases/latest/download/manifest.json"
}

// releaseBase is where a release's archives live, derived from the manifest
// location so a mirror or a test server needs no extra configuration.
func releaseBase(location string) string {
	index := strings.LastIndex(location, "/latest/download/")
	if index < 0 {
		return ""
	}
	return location[:index] + "/download"
}

func releasePageURL(location string) string {
	index := strings.LastIndex(location, "/releases/")
	if index < 0 {
		return ""
	}
	return location[:index] + "/releases"
}

// requireSecureLocation enforces the installer's transport contract: release
// metadata and archives travel over HTTPS only. A loopback address is exempt
// because it cannot be intercepted in transit, and a locally served manifest is
// how the update path is exercised without publishing a release.
func requireSecureLocation(location string) error {
	parsed, err := url.Parse(strings.TrimSpace(location))
	if err != nil {
		return errors.New("更新地址无效")
	}
	switch parsed.Scheme {
	case "https":
		return nil
	case "http":
		host := parsed.Hostname()
		if host == "localhost" {
			return nil
		}
		if ip := net.ParseIP(host); ip != nil && ip.IsLoopback() {
			return nil
		}
		return errors.New("更新地址必须使用 HTTPS")
	default:
		return errors.New("更新地址无效")
	}
}

// Status returns the cached status, refreshing at most once per hour.
func (s *Service) Status(ctx context.Context) Status {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cache != nil && time.Since(s.cachedAt) < time.Hour {
		return *s.cache
	}
	status := s.check(ctx)
	s.cache = &status
	s.cachedAt = time.Now()
	return status
}

func (s *Service) check(ctx context.Context) Status {
	status := Status{CurrentVersion: s.Version, CheckedAt: time.Now().UTC()}
	// Status holds s.mu across this call while sync.Mutex.Lock ignores
	// contexts, so an unbounded check would wedge every later caller behind the
	// mutex. Bound it here rather than on the shared client, because Apply
	// reuses that client for an archive download that can legitimately run far
	// longer than a metadata lookup.
	ctx, cancel := context.WithTimeout(ctx, defaultUpdateTimeout)
	defer cancel()

	location := s.ManifestLocation()
	manifest, err := s.fetchManifest(ctx, location)
	if err != nil {
		status.Error = err.Error()
		return status
	}
	status.LatestVersion = manifest.Version
	status.ReleaseURL = releasePageURL(location)
	asset, ok := SelectAsset(manifest, s.AssetArch)
	if !ok {
		status.Error = "最新版本暂未提供本机安装包"
		return status
	}
	status.AssetName = assetFileName(asset.URL)
	status.UpdateAvailable = CompareVersions(manifest.Version, s.Version) > 0
	return status
}

func (s *Service) fetchManifest(ctx context.Context, location string) (Manifest, error) {
	if err := requireSecureLocation(location); err != nil {
		return Manifest{}, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, location, nil)
	if err != nil {
		return Manifest{}, errors.New("无法发起更新检查")
	}
	request.Header.Set("User-Agent", "study-os")
	response, err := s.HTTPClient.Do(request)
	if err != nil {
		return Manifest{}, errors.New("无法连接更新服务器")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return Manifest{}, fmt.Errorf("更新服务器返回 %d", response.StatusCode)
	}
	var manifest Manifest
	if err := json.NewDecoder(io.LimitReader(response.Body, 2<<20)).Decode(&manifest); err != nil {
		return Manifest{}, errors.New("无法解析更新信息")
	}
	if manifest.Version == "" {
		return Manifest{}, errors.New("更新信息缺少版本号")
	}
	return manifest, nil
}

// SelectAsset picks the single Windows archive for one architecture.
func SelectAsset(manifest Manifest, architecture string) (AssetEntry, bool) {
	for _, asset := range manifest.Assets {
		if strings.EqualFold(asset.OS, "windows") && strings.EqualFold(asset.Arch, architecture) {
			return asset, true
		}
	}
	return AssetEntry{}, false
}

// assetFileName is the trailing name of a manifest asset URL, which may be
// absolute or relative to the manifest's directory.
func assetFileName(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}
	if index := strings.Index(trimmed, "://"); index >= 0 {
		remainder := trimmed[index+3:]
		if slash := strings.Index(remainder, "/"); slash >= 0 {
			return filepath.Base(remainder[slash:])
		}
		return ""
	}
	return filepath.Base(trimmed)
}

// resolveAssetLocation turns a manifest asset reference into a URL. Remote
// manifests must use HTTPS, mirroring install.ps1's contract.
func resolveAssetLocation(manifestLocation, assetURL string) (string, error) {
	resolved := strings.TrimSpace(assetURL)
	if resolved == "" {
		return "", errors.New("更新信息缺少安装包地址")
	}
	if strings.Contains(resolved, "://") {
		if err := requireSecureLocation(resolved); err != nil {
			return "", err
		}
		return resolved, nil
	}
	base := releaseBase(manifestLocation)
	if base == "" {
		return "", errors.New("更新信息无法解析安装包地址")
	}
	relative := strings.TrimRight(base, "/") + "/" + strings.TrimLeft(resolved, "/")
	if err := requireSecureLocation(relative); err != nil {
		return "", err
	}
	return relative, nil
}

// InstalledRoot reports the managed install root for an executable path in the
// layout install.ps1 creates: <root>\versions\<version>\StudyOS.exe. A portable
// or development build has no managed root, so automatic updates stay off
// rather than overwriting a directory the installer does not own.
func InstalledRoot(executablePath string) (string, bool) {
	if strings.TrimSpace(executablePath) == "" {
		return "", false
	}
	versionDir := filepath.Dir(filepath.Clean(executablePath))
	versionsDir := filepath.Dir(versionDir)
	if !strings.EqualFold(filepath.Base(versionsDir), "versions") {
		return "", false
	}
	root := filepath.Dir(versionsDir)
	if root == "" || root == versionsDir {
		return "", false
	}
	return root, true
}

// Apply downloads the newest release, verifies it, stages it beside the running
// version, and flips the current pointer. Windows refuses to overwrite a
// running executable, so the swap itself happens in a restart script after this
// process exits; OnStaged asks the app to quit so that script can run.
func (s *Service) Apply(ctx context.Context) (Status, error) {
	status := s.Status(ctx)
	if !status.UpdateAvailable {
		if status.Error != "" {
			return status, errors.New(status.Error)
		}
		return status, errors.New("当前已经是最新版本")
	}
	if s.InstallRoot == "" {
		return status, errors.New("当前是便携版或开发版本，请下载新的安装包更新")
	}

	location := s.ManifestLocation()
	manifest, err := s.fetchManifest(ctx, location)
	if err != nil {
		return status, err
	}
	asset, ok := SelectAsset(manifest, s.AssetArch)
	if !ok {
		return status, errors.New("最新版本暂未提供本机安装包")
	}
	assetLocation, err := resolveAssetLocation(location, asset.URL)
	if err != nil {
		return status, err
	}

	stagingRoot := filepath.Join(s.InstallRoot, ".staging")
	if err := os.MkdirAll(stagingRoot, 0o700); err != nil {
		return status, fmt.Errorf("创建暂存目录失败: %w", err)
	}
	workDir, err := os.MkdirTemp(stagingRoot, "update-")
	if err != nil {
		return status, fmt.Errorf("创建暂存目录失败: %w", err)
	}
	defer os.RemoveAll(workDir)

	archivePath := filepath.Join(workDir, "release.zip")
	if err := s.download(ctx, assetLocation, archivePath); err != nil {
		return status, err
	}
	if err := VerifyArchive(archivePath, asset.SHA256); err != nil {
		return status, err
	}
	extracted := filepath.Join(workDir, "payload")
	if err := unzip(archivePath, extracted); err != nil {
		return status, fmt.Errorf("解压更新包失败: %w", err)
	}
	// This updater only ever installs desktop builds, so the archive must carry
	// the desktop executable. Trusting the manifest entrypoint instead would let a
	// launcher-style archive (a server binary plus a web directory) be installed as
	// the desktop app and leave the shortcut pointing at nothing.
	if _, err := os.Stat(filepath.Join(extracted, desktopEntrypoint)); err != nil {
		return status, errors.New("更新包缺少桌面程序")
	}

	versionDir := filepath.Join(s.InstallRoot, "versions", manifest.Version)
	if err := os.MkdirAll(filepath.Dir(versionDir), 0o755); err != nil {
		return status, fmt.Errorf("创建版本目录失败: %w", err)
	}
	// A directory for this version may already exist. Move it aside so a failed
	// replacement cannot leave a half-updated install behind.
	replacedVersionDir := ""
	if _, err := os.Stat(versionDir); err == nil {
		replacedVersionDir = versionDir + ".rollback-" + strconv.FormatInt(time.Now().UnixNano(), 16)
		if err := os.Rename(versionDir, replacedVersionDir); err != nil {
			return status, fmt.Errorf("准备版本目录失败: %w", err)
		}
	}
	restoreVersionDir := func() {
		_ = os.RemoveAll(versionDir)
		if replacedVersionDir != "" {
			_ = os.Rename(replacedVersionDir, versionDir)
		}
	}
	if err := os.Rename(extracted, versionDir); err != nil {
		restoreVersionDir()
		return status, fmt.Errorf("写入版本目录失败: %w", err)
	}

	if err := WriteCurrentPointer(s.InstallRoot, manifest.Version, versionDir, desktopEntrypoint); err != nil {
		restoreVersionDir()
		return status, err
	}
	if replacedVersionDir != "" {
		_ = os.RemoveAll(replacedVersionDir)
	}
	if err := s.writeRestartScript(); err != nil {
		return status, err
	}
	if s.OnStaged != nil {
		s.OnStaged()
	}
	return status, nil
}

// pointer mirrors install.ps1's current.json.
type pointer struct {
	Version    string `json:"version"`
	Path       string `json:"path"`
	Entrypoint string `json:"entrypoint"`
	UpdatedAt  string `json:"updated_at"`
}

// WriteCurrentPointer switches the live install: the pointer is written to a
// temporary file and moved over the old one, so a crash mid-write cannot leave
// a truncated pointer behind.
func WriteCurrentPointer(installRoot, version, versionPath, entrypoint string) error {
	if entrypoint == "" {
		entrypoint = desktopEntrypoint
	}
	contents, err := json.MarshalIndent(pointer{
		Version:    version,
		Path:       filepath.Clean(versionPath),
		Entrypoint: entrypoint,
		UpdatedAt:  time.Now().UTC().Format(time.RFC3339Nano),
	}, "", "  ")
	if err != nil {
		return fmt.Errorf("生成版本指针失败: %w", err)
	}
	target := filepath.Join(installRoot, "current.json")
	temporary := target + "." + strconv.FormatInt(time.Now().UnixNano(), 16) + ".tmp"
	if err := os.WriteFile(temporary, contents, 0o600); err != nil {
		return fmt.Errorf("写入版本指针失败: %w", err)
	}
	if err := os.Rename(temporary, target); err != nil {
		_ = os.Remove(temporary)
		return fmt.Errorf("切换版本指针失败: %w", err)
	}
	return nil
}

func (s *Service) download(ctx context.Context, url, destination string) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return fmt.Errorf("创建下载请求失败: %w", err)
	}
	request.Header.Set("User-Agent", "study-os")
	response, err := s.HTTPClient.Do(request)
	if err != nil {
		return fmt.Errorf("下载失败: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("下载返回 %d", response.StatusCode)
	}
	file, err := os.Create(destination)
	if err != nil {
		return fmt.Errorf("写入下载文件失败: %w", err)
	}
	defer file.Close()
	if _, err := io.Copy(file, io.LimitReader(response.Body, 256<<20)); err != nil {
		return fmt.Errorf("保存下载文件失败: %w", err)
	}
	return nil
}

// VerifyArchive checks a downloaded archive against the manifest checksum.
func VerifyArchive(archivePath, expected string) error {
	want := strings.ToLower(strings.TrimSpace(expected))
	if want == "" {
		return errors.New("更新信息缺少校验值")
	}
	content, err := os.ReadFile(archivePath)
	if err != nil {
		return fmt.Errorf("读取安装包失败: %w", err)
	}
	sum := sha256.Sum256(content)
	if actual := hex.EncodeToString(sum[:]); actual != want {
		return errors.New("安装包校验失败")
	}
	return nil
}

func unzip(source, destination string) error {
	archive, err := zip.OpenReader(source)
	if err != nil {
		return err
	}
	defer archive.Close()
	cleaned := filepath.Clean(destination) + string(os.PathSeparator)
	for _, file := range archive.File {
		target := filepath.Join(destination, file.Name)
		if !strings.HasPrefix(target, cleaned) {
			return errors.New("更新包包含不安全路径")
		}
		if file.FileInfo().IsDir() {
			if err := os.MkdirAll(target, 0o700); err != nil {
				return err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
			return err
		}
		reader, err := file.Open()
		if err != nil {
			return err
		}
		writer, err := os.Create(target)
		if err != nil {
			_ = reader.Close()
			return err
		}
		if _, err := io.Copy(writer, reader); err != nil {
			_ = reader.Close()
			_ = writer.Close()
			return err
		}
		_ = reader.Close()
		if err := writer.Close(); err != nil {
			return err
		}
	}
	return nil
}

// writeRestartScript defers relaunching to a detached batch script. The current
// pointer already names the new version, so the installed launcher starts the
// replacement build once this process has exited and released its executable.
func (s *Service) writeRestartScript() error {
	launcher := filepath.Join(s.InstallRoot, "StudyOS.cmd")
	script := "@echo off\r\n" +
		"timeout /t 2 /nobreak >nul\r\n" +
		"rmdir /s /q \"" + filepath.Join(s.InstallRoot, ".staging") + "\" 2>nul\r\n" +
		"del /f /q \"" + filepath.Join(s.InstallRoot, "restart.cmd") + "\"\r\n" +
		"start \"\" \"" + launcher + "\"\r\n"
	path := filepath.Join(s.InstallRoot, "restart.cmd")
	if err := os.WriteFile(path, []byte(script), 0o600); err != nil {
		return fmt.Errorf("写入更新脚本失败: %w", err)
	}
	return nil
}

// RestartScriptPath is the detached script that swaps in the staged build. The
// desktop app must start it before it exits, because Windows will not let a
// running process replace its own executable.
func (s *Service) RestartScriptPath() string {
	if s.InstallRoot == "" {
		return ""
	}
	return filepath.Join(s.InstallRoot, "restart.cmd")
}

var versionPattern = regexp.MustCompile(`[0-9]+(?:\.[0-9]+)*`)

// CompareVersions orders dotted versions, ignoring a leading v and any build
// suffix, so "0.2.0-dev" equals "0.2.0".
func CompareVersions(a, b string) int {
	parse := func(value string) []int {
		match := versionPattern.FindString(value)
		if match == "" {
			return nil
		}
		parts := strings.Split(match, ".")
		result := make([]int, 0, len(parts))
		for _, part := range parts {
			number, _ := strconv.Atoi(part)
			result = append(result, number)
		}
		return result
	}
	left, right := parse(a), parse(b)
	for i := 0; i < len(left) || i < len(right); i++ {
		l, r := 0, 0
		if i < len(left) {
			l = left[i]
		}
		if i < len(right) {
			r = right[i]
		}
		if l < r {
			return -1
		}
		if l > r {
			return 1
		}
	}
	return 0
}
