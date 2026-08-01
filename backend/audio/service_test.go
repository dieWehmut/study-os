package audio

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

type recordingGenerator struct {
	calls   int
	content []byte
	err     error
}

func (g *recordingGenerator) Generate(ctx context.Context, request Request, destination string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	g.calls++
	if g.err != nil {
		return g.err
	}
	return os.WriteFile(destination, g.content, 0o600)
}

func TestCacheKeyNormalizesRequestButSeparatesMeaningfulFields(t *testing.T) {
	first := Request{Term: "  Abandon  ", Locale: " EN-us ", Voice: " Alice ", Format: ".WAV"}
	second := Request{Term: "abandon", Locale: "en-US", Voice: "alice", Format: "wav"}
	if got, want := CacheKey(first), CacheKey(second); got != want {
		t.Fatalf("equivalent requests have different cache keys: %q != %q", got, want)
	}
	if CacheKey(first) == CacheKey(Request{Term: "abandon", Locale: "en-US", Voice: "bob", Format: "wav"}) {
		t.Fatal("voice must be part of cache key")
	}
	if len(CacheKey(first)) != 64 {
		t.Fatalf("cache key length = %d, want SHA-256 hex length", len(CacheKey(first)))
	}
}

func TestCacheKeyIgnoresLocalStoragePath(t *testing.T) {
	first := Request{Term: "abandon", Locale: "en-US", LocalPath: "dictionary-a/abandon.mp3"}
	second := Request{Term: "abandon", Locale: "en-US", LocalPath: "dictionary-b/abandon.mp3"}
	if CacheKey(first) != CacheKey(second) {
		t.Fatal("storage location must not change pronunciation identity")
	}
}

func TestCacheKeyTreatsDefaultFormatAsWAV(t *testing.T) {
	implicit := Request{Term: "abandon", Locale: "en-US"}
	explicit := Request{Term: "abandon", Locale: "en-US", Format: "wav"}
	if CacheKey(implicit) != CacheKey(explicit) {
		t.Fatal("the default format and explicit WAV must share a cache entry")
	}
}

func TestResolvePrefersLocalEntryAndOpenProvidesRangeMetadata(t *testing.T) {
	localDir := t.TempDir()
	cacheDir := t.TempDir()
	content := []byte("local-audio")
	if err := os.WriteFile(filepath.Join(localDir, "abandon.mp3"), content, 0o600); err != nil {
		t.Fatal(err)
	}
	generator := &recordingGenerator{content: []byte("generated")}
	service, err := NewService(cacheDir, WithLocalDir(localDir), WithGenerator(generator))
	if err != nil {
		t.Fatal(err)
	}

	request := Request{Term: "abandon", Locale: "en-US"}
	asset, err := service.Resolve(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	if asset.Source != SourceLocal || asset.MIME != "audio/mpeg" {
		t.Fatalf("local asset = %#v, want local audio/mpeg", asset)
	}
	if asset.Size != int64(len(content)) || asset.Key != CacheKey(request) {
		t.Fatalf("local metadata = %#v", asset)
	}
	if generator.calls != 0 {
		t.Fatalf("generator calls = %d, want local-first lookup", generator.calls)
	}

	opened, err := service.Open(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	defer opened.Close()
	got, err := io.ReadAll(opened)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(content) {
		t.Fatalf("opened content = %q, want %q", got, content)
	}
	if opened.MIME != "audio/mpeg" || opened.Size != int64(len(content)) {
		t.Fatalf("opened metadata = %#v", opened.Asset)
	}
	recorder := httptest.NewRecorder()
	httpRequest := httptest.NewRequest(http.MethodGet, "/api/audio", nil)
	httpRequest.Header.Set("Range", "bytes=1-4")
	recorder.Header().Set("Content-Type", opened.MIME)
	http.ServeContent(recorder, httpRequest, opened.Asset.Name, opened.ModTime, opened)
	if recorder.Code != http.StatusPartialContent || recorder.Body.String() != string(content[1:5]) {
		t.Fatalf("range response = %d %q", recorder.Code, recorder.Body.String())
	}
}

func TestResolveUsesCacheAndGeneratorOnlyOnce(t *testing.T) {
	cacheDir := t.TempDir()
	generator := &recordingGenerator{content: []byte("generated-audio")}
	service, err := NewService(cacheDir, WithGenerator(generator))
	if err != nil {
		t.Fatal(err)
	}
	request := Request{Term: "serendipity", Locale: "en-US", Voice: "default"}

	first, err := service.Resolve(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	if first.Source != SourceGenerated || first.MIME != "audio/wav" {
		t.Fatalf("first asset = %#v, want generated WAV", first)
	}
	second, err := service.Resolve(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	if second.Source != SourceCache || second.Path != first.Path {
		t.Fatalf("cached asset = %#v, want same path from cache", second)
	}
	if generator.calls != 1 {
		t.Fatalf("generator calls = %d, want 1", generator.calls)
	}
}

func TestResolveExplicitLocalPathRejectsTraversal(t *testing.T) {
	service, err := NewService(t.TempDir(), WithLocalDir(t.TempDir()))
	if err != nil {
		t.Fatal(err)
	}
	_, err = service.Resolve(context.Background(), Request{
		Term:      "safe term",
		LocalPath: filepath.Join("..", "outside.mp3"),
	})
	if !errors.Is(err, ErrUnsafePath) {
		t.Fatalf("error = %v, want ErrUnsafePath", err)
	}
}

func TestResolveExplicitMissingLocalPathFallsBackToGenerator(t *testing.T) {
	generator := &recordingGenerator{content: []byte("generated")}
	service, err := NewService(t.TempDir(), WithLocalDir(t.TempDir()), WithGenerator(generator))
	if err != nil {
		t.Fatal(err)
	}
	asset, err := service.Resolve(context.Background(), Request{Term: "fallback", LocalPath: "missing.mp3"})
	if err != nil {
		t.Fatal(err)
	}
	if asset.Source != SourceGenerated || generator.calls != 1 {
		t.Fatalf("asset = %#v, calls = %d", asset, generator.calls)
	}
}

func TestResolveDoesNotGuessUnsafeFilenameForPunctuationOnlyTerm(t *testing.T) {
	localDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(localDir, ".mp3"), []byte("hidden"), 0o600); err != nil {
		t.Fatal(err)
	}
	service, err := NewService(t.TempDir(), WithLocalDir(localDir))
	if err != nil {
		t.Fatal(err)
	}
	_, err = service.Resolve(context.Background(), Request{Term: "..."})
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("error = %v, want ErrNotFound", err)
	}
}

func TestResolveRejectsSymlinkEscape(t *testing.T) {
	localDir := t.TempDir()
	outside := filepath.Join(t.TempDir(), "outside.mp3")
	if err := os.WriteFile(outside, []byte("secret"), 0o600); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(localDir, "escape.mp3")
	if err := os.Symlink(outside, link); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	service, err := NewService(t.TempDir(), WithLocalDir(localDir))
	if err != nil {
		t.Fatal(err)
	}
	_, err = service.Resolve(context.Background(), Request{Term: "escape", LocalPath: "escape.mp3"})
	if !errors.Is(err, ErrUnsafePath) {
		t.Fatalf("error = %v, want ErrUnsafePath", err)
	}
}

func TestResolveMissingAssetIsRecoverable(t *testing.T) {
	service, err := NewService(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	_, err = service.Resolve(context.Background(), Request{Term: "unknown"})
	if !errors.Is(err, ErrNotFound) || !IsRecoverable(err) {
		t.Fatalf("error = %v, want recoverable ErrNotFound", err)
	}
}

func TestSAPIProviderReturnsRecoverableErrorOffWindows(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("the unavailable boundary is platform-specific")
	}
	provider := NewSAPIProvider()
	err := provider.Generate(context.Background(), Request{Term: "hello"}, filepath.Join(t.TempDir(), "hello.wav"))
	if !errors.Is(err, ErrGeneratorUnavailable) || !IsRecoverable(err) {
		t.Fatalf("error = %v, want recoverable ErrGeneratorUnavailable", err)
	}
}

func TestSAPIProviderCreatesWAVOnWindows(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows integration test")
	}
	destination := filepath.Join(t.TempDir(), "hello.wav")
	err := NewSAPIProvider().Generate(context.Background(), Request{Term: "hello", Locale: "en-US"}, destination)
	if err != nil {
		if errors.Is(err, ErrGeneratorUnavailable) {
			t.Skipf("SAPI unavailable on this Windows installation: %v", err)
		}
		t.Fatal(err)
	}
	header := make([]byte, 12)
	file, err := os.Open(destination)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	if _, err := io.ReadFull(file, header); err != nil {
		t.Fatal(err)
	}
	if string(header[:4]) != "RIFF" || string(header[8:]) != "WAVE" {
		t.Fatalf("header = %q, want RIFF/WAVE", header)
	}
}

func TestUnsupportedGeneratorFormatIsRecoverable(t *testing.T) {
	service, err := NewService(t.TempDir(), WithGenerator(&recordingGenerator{content: []byte("audio")}))
	if err != nil {
		t.Fatal(err)
	}
	_, err = service.Resolve(context.Background(), Request{Term: "word", Format: "exe"})
	if !errors.Is(err, ErrUnsupportedFormat) || !IsRecoverable(err) {
		t.Fatalf("error = %v, want recoverable ErrUnsupportedFormat", err)
	}
}

func TestOpenHonorsContextCancellation(t *testing.T) {
	service, err := NewService(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err = service.Open(ctx, Request{Term: "cancelled"})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("error = %v, want context.Canceled", err)
	}
}

func TestAssetModTimeIsUTCComparable(t *testing.T) {
	localDir := t.TempDir()
	path := filepath.Join(localDir, "word.wav")
	if err := os.WriteFile(path, []byte("wav"), 0o600); err != nil {
		t.Fatal(err)
	}
	stamp := time.Date(2026, 8, 2, 3, 4, 5, 0, time.FixedZone("CST", 8*60*60))
	if err := os.Chtimes(path, stamp, stamp); err != nil {
		t.Fatal(err)
	}
	service, err := NewService(t.TempDir(), WithLocalDir(localDir))
	if err != nil {
		t.Fatal(err)
	}
	asset, err := service.Resolve(context.Background(), Request{Term: "word"})
	if err != nil {
		t.Fatal(err)
	}
	if asset.ModTime.Location() != time.UTC || !strings.HasPrefix(asset.MIME, "audio/") {
		t.Fatalf("asset metadata = %#v", asset)
	}
}
