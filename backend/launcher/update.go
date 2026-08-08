package launcher

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type Status struct {
	CurrentVersion  string    `json:"current_version"`
	LatestVersion   string    `json:"latest_version,omitempty"`
	UpdateAvailable bool      `json:"update_available"`
	ReleaseNotes    string    `json:"release_notes,omitempty"`
	ReleaseURL      string    `json:"release_url,omitempty"`
	AssetName       string    `json:"asset_name,omitempty"`
	CheckedAt       time.Time `json:"checked_at"`
	Error           string    `json:"error,omitempty"`
}

type githubRelease struct {
	TagName string `json:"tag_name"`
	Body    string `json:"body"`
	HTMLURL string `json:"html_url"`
	Assets  []struct {
		Name               string `json:"name"`
		BrowserDownloadURL string `json:"browser_download_url"`
	} `json:"assets"`
}

func (s *Service) check(ctx context.Context) Status {
	status := Status{CurrentVersion: s.Version, CheckedAt: time.Now().UTC()}
	// Status holds s.mu across this call and sync.Mutex.Lock ignores contexts,
	// so an unbounded check does not just stall its own caller -- it wedges
	// every later one behind the mutex. Bound it here rather than on the shared
	// client: Apply reuses that client to pull a release archive, which can
	// legitimately run far longer than a metadata lookup.
	ctx, cancel := context.WithTimeout(ctx, defaultUpdateTimeout)
	defer cancel()
	apiBase := strings.TrimRight(s.APIBase, "/")
	if apiBase == "" {
		apiBase = "https://api.github.com"
	}
	endpoint := apiBase + "/repos/" + s.Repo + "/releases/latest"
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		status.Error = "无法发起更新检查"
		return status
	}
	request.Header.Set("Accept", "application/vnd.github+json")
	request.Header.Set("User-Agent", "study-os")
	response, err := s.HTTPClient.Do(request)
	if err != nil {
		status.Error = "无法连接更新服务器"
		return status
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		status.Error = fmt.Sprintf("更新服务器返回 %d", response.StatusCode)
		return status
	}
	var release githubRelease
	if err := json.NewDecoder(io.LimitReader(response.Body, 2<<20)).Decode(&release); err != nil {
		status.Error = "无法解析更新信息"
		return status
	}
	latest := strings.TrimPrefix(strings.TrimSpace(release.TagName), "v")
	assetName := fmt.Sprintf("study-os-pwa-windows-%s.zip", s.AssetArch)
	status.LatestVersion = latest
	status.ReleaseNotes = strings.TrimSpace(release.Body)
	status.ReleaseURL = release.HTMLURL
	for _, asset := range release.Assets {
		if asset.Name == assetName {
			status.AssetName = assetName
			break
		}
	}
	if status.AssetName == "" {
		status.Error = "最新版本暂未提供本机安装包"
		return status
	}
	status.UpdateAvailable = compareVersions(latest, s.Version) > 0
	return status
}

// Apply downloads, verifies, and stages the latest release. The actual file
// swap happens through a generated restart.cmd so a running executable can be
// replaced safely on Windows.
func (s *Service) Apply(ctx context.Context) (Status, error) {
	status := s.Status(ctx)
	if !status.UpdateAvailable || status.AssetName == "" {
		return status, errors.New("当前没有可应用的更新")
	}
	base := strings.TrimRight(s.DownloadBase, "/")
	if base == "" {
		base = "https://github.com/" + s.Repo
	}
	assetURL := base + "/releases/download/v" + status.LatestVersion + "/" + status.AssetName
	checksumURL := assetURL + ".sha256"
	if err := os.MkdirAll(s.DataDir, 0o700); err != nil {
		return status, fmt.Errorf("创建更新目录失败: %w", err)
	}
	tmp := filepath.Join(s.DataDir, "update-tmp")
	if err := os.MkdirAll(tmp, 0o700); err != nil {
		return status, fmt.Errorf("创建临时目录失败: %w", err)
	}
	zipPath := filepath.Join(tmp, status.AssetName)
	shaPath := zipPath + ".sha256"
	if err := s.download(ctx, assetURL, zipPath); err != nil {
		return status, err
	}
	if err := s.download(ctx, checksumURL, shaPath); err != nil {
		return status, errors.New("缺少校验文件，已停止更新")
	}
	if err := verifyChecksum(zipPath, shaPath); err != nil {
		return status, err
	}
	versionDir := filepath.Join(s.DataDir, "update-staging", status.LatestVersion)
	if err := os.RemoveAll(versionDir); err != nil {
		return status, fmt.Errorf("清理旧暂存失败: %w", err)
	}
	if err := unzip(zipPath, versionDir); err != nil {
		return status, fmt.Errorf("解压更新包失败: %w", err)
	}
	if _, err := os.Stat(filepath.Join(versionDir, "study-os-server.exe")); err != nil {
		return status, errors.New("更新包缺少服务程序")
	}
	if _, err := os.Stat(filepath.Join(versionDir, "web", "index.html")); err != nil {
		return status, errors.New("更新包缺少网页文件")
	}
	if err := writeRestartScript(s.DataDir, status.LatestVersion); err != nil {
		return status, err
	}
	return status, nil
}

func (s *Service) Restart() {
	if s.OnRestart != nil {
		go s.OnRestart()
	}
	s.Close()
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

func verifyChecksum(filePath, shaPath string) error {
	content, err := os.ReadFile(shaPath)
	if err != nil {
		return fmt.Errorf("读取校验文件失败: %w", err)
	}
	expected := strings.Fields(string(content))
	if len(expected) == 0 {
		return errors.New("校验文件格式无效")
	}
	sum, err := os.ReadFile(filePath)
	if err != nil {
		return fmt.Errorf("读取安装包失败: %w", err)
	}
	hash := sha256.Sum256(sum)
	actual := hex.EncodeToString(hash[:])
	if !strings.EqualFold(actual, expected[0]) {
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
	for _, file := range archive.File {
		target := filepath.Join(destination, file.Name)
		if !strings.HasPrefix(target, filepath.Clean(destination)+string(os.PathSeparator)) {
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

func writeRestartScript(dataDir, version string) error {
	base := filepath.Clean(dataDir) + string(os.PathSeparator)
	script := `@echo off
set BASE=` + base + `
timeout /t 2 /nobreak >nul
taskkill /IM study-os-server.exe /F >nul 2>&1
if exist "%BASE%study-os-server.exe.old" del /f /q "%BASE%study-os-server.exe.old"
if exist "%BASE%study-os-server.exe" ren "%BASE%study-os-server.exe" study-os-server.exe.old
if exist "%BASE%web.old" rmdir /s /q "%BASE%web.old"
if exist "%BASE%web" ren "%BASE%web" web.old
xcopy /e /i /y "%BASE%update-staging\` + version + `\study-os-server.exe" "%BASE%" >nul
xcopy /e /i /y "%BASE%update-staging\` + version + `\web" "%BASE%web" >nul
rmdir /s /q "%BASE%update-staging"
del /f /q "%BASE%restart.cmd"
set STUDY_OS_LAUNCHER=1
start "" /b "%BASE%study-os-server.exe"
`
	path := filepath.Join(dataDir, "restart.cmd")
	if err := os.WriteFile(path, []byte(script), 0o600); err != nil {
		return fmt.Errorf("写入更新脚本失败: %w", err)
	}
	return nil
}

var versionPattern = regexp.MustCompile(`[0-9]+(?:\.[0-9]+)*`)

func compareVersions(a, b string) int {
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
