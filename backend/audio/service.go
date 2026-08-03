// Package audio resolves local-first pronunciation audio and maintains a
// deterministic generated-audio cache. HTTP adapters can pass Opened directly
// to http.ServeContent to support conditional and byte-range requests.
package audio

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"os"
	"path/filepath"
	"strings"
	"time"
)

var (
	ErrNotFound             = errors.New("audio asset not found")
	ErrUnsafePath           = errors.New("unsafe audio path")
	ErrGeneratorUnavailable = errors.New("audio generator unavailable")
	ErrUnsupportedFormat    = errors.New("unsupported audio format")
)

type Source string

const (
	SourceLocal     Source = "local"
	SourceCache     Source = "cache"
	SourceGenerated Source = "generated"
)

type Request struct {
	Term      string `json:"term"`
	Locale    string `json:"locale,omitempty"`
	Voice     string `json:"voice,omitempty"`
	Format    string `json:"format,omitempty"`
	Provider  string `json:"provider,omitempty"`
	LocalPath string `json:"local_path,omitempty"`
}

type Asset struct {
	Key     string    `json:"key"`
	Path    string    `json:"-"`
	Name    string    `json:"name"`
	MIME    string    `json:"mime"`
	Size    int64     `json:"size"`
	ModTime time.Time `json:"modified_at"`
	Source  Source    `json:"source"`
}

type Opened struct {
	Asset
	*os.File
}

func (opened *Opened) Close() error {
	if opened == nil || opened.File == nil {
		return nil
	}
	return opened.File.Close()
}

type Generator interface {
	Generate(context.Context, Request, string) error
}

type Segment struct {
	Start int64  `json:"start"`
	End   int64  `json:"end"`
	Text  string `json:"text"`
}

type Timeline struct {
	Segments []Segment `json:"segments"`
}

// TimelineGenerator is an optional capability: generators that can produce
// timing metadata (for example cloud TTS) return it alongside the audio file.
type TimelineGenerator interface {
	GenerateWithTimeline(context.Context, Request, string) (Timeline, error)
}

type Service struct {
	cacheDir  string
	localDir  string
	generator Generator
}

type Option func(*Service) error

func WithLocalDir(root string) Option {
	return func(service *Service) error {
		absolute, err := cleanRoot(root)
		if err != nil {
			return fmt.Errorf("configure local audio directory: %w", err)
		}
		service.localDir = absolute
		return nil
	}
}

func WithGenerator(generator Generator) Option {
	return func(service *Service) error {
		service.generator = generator
		return nil
	}
}

func NewService(cacheDir string, options ...Option) (*Service, error) {
	root, err := cleanRoot(cacheDir)
	if err != nil {
		return nil, fmt.Errorf("configure audio cache: %w", err)
	}
	if err := os.MkdirAll(root, 0o700); err != nil {
		return nil, fmt.Errorf("create audio cache: %w", err)
	}
	service := &Service{cacheDir: root}
	for _, option := range options {
		if option != nil {
			if err := option(service); err != nil {
				return nil, err
			}
		}
	}
	return service, nil
}

func CacheKey(request Request) string {
	normalized := normalizeRequest(request)
	if normalized.Format == "" {
		normalized.Format = "wav"
	}
	payload := strings.Join([]string{
		normalized.Term,
		normalized.Locale,
		normalized.Voice,
		normalized.Format,
		normalized.Provider,
	}, "\x00")
	sum := sha256.Sum256([]byte(payload))
	return hex.EncodeToString(sum[:])
}

func (service *Service) Resolve(ctx context.Context, request Request) (Asset, error) {
	return service.resolve(ctx, request, true)
}

// ResolveExisting returns local or cached audio without invoking a generator.
// Read-only HTTP endpoints use it so a cross-site GET cannot start a process or
// grow the cache as a side effect.
func (service *Service) ResolveExisting(ctx context.Context, request Request) (Asset, error) {
	return service.resolve(ctx, request, false)
}

func (service *Service) resolve(ctx context.Context, request Request, generate bool) (Asset, error) {
	if err := ctx.Err(); err != nil {
		return Asset{}, err
	}
	if service == nil {
		return Asset{}, errors.New("audio service is nil")
	}
	request = normalizeRequest(request)
	if request.Term == "" && request.LocalPath == "" {
		return Asset{}, fmt.Errorf("%w: empty term", ErrNotFound)
	}
	key := CacheKey(request)

	if service.localDir != "" {
		localPath, found, err := service.resolveLocalPath(request)
		if err != nil {
			return Asset{}, err
		}
		if found {
			return inspectAsset(localPath, key, SourceLocal)
		}
	}

	format, err := normalizedFormat(request.Format)
	if err != nil {
		return Asset{}, err
	}
	cachePath := filepath.Join(service.cacheDir, key+"."+format)
	if asset, err := inspectSecureAsset(service.cacheDir, cachePath, key, SourceCache); err == nil {
		return asset, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return Asset{}, err
	}
	if !generate || service.generator == nil {
		return Asset{}, fmt.Errorf("%w: no local file, cached file, or generator", ErrNotFound)
	}

	temporary, err := os.CreateTemp(service.cacheDir, ".audio-*."+format)
	if err != nil {
		return Asset{}, fmt.Errorf("create audio cache temporary file: %w", err)
	}
	temporaryPath := temporary.Name()
	if err := temporary.Close(); err != nil {
		_ = os.Remove(temporaryPath)
		return Asset{}, fmt.Errorf("close audio cache temporary file: %w", err)
	}
	defer os.Remove(temporaryPath)

	request.Format = format
	var timeline Timeline
	if timelineGenerator, ok := service.generator.(TimelineGenerator); ok {
		timeline, err = timelineGenerator.GenerateWithTimeline(ctx, request, temporaryPath)
	} else {
		err = service.generator.Generate(ctx, request, temporaryPath)
	}
	if err != nil {
		return Asset{}, fmt.Errorf("generate pronunciation audio: %w", err)
	}
	if _, err := inspectSecureAsset(service.cacheDir, temporaryPath, key, SourceGenerated); err != nil {
		return Asset{}, fmt.Errorf("validate generated audio: %w", err)
	}
	if err := os.Rename(temporaryPath, cachePath); err != nil {
		if _, statErr := os.Stat(cachePath); statErr != nil {
			return Asset{}, fmt.Errorf("publish generated audio: %w", err)
		}
	}
	if len(timeline.Segments) > 0 {
		_ = writeTimelineSidecar(service.cacheDir, cachePath, timeline)
	}
	return inspectSecureAsset(service.cacheDir, cachePath, key, SourceGenerated)
}

// Timeline returns the persisted timing metadata for a generated asset, or an
// empty timeline when no sidecar exists (for example local/SAPI audio).
func (service *Service) Timeline(ctx context.Context, request Request) (Timeline, error) {
	if err := ctx.Err(); err != nil {
		return Timeline{}, err
	}
	if service == nil {
		return Timeline{}, errors.New("audio service is nil")
	}
	request = normalizeRequest(request)
	if request.Term == "" && request.LocalPath == "" {
		return Timeline{}, fmt.Errorf("%w: empty term", ErrNotFound)
	}
	format, err := normalizedFormat(request.Format)
	if err != nil {
		return Timeline{}, err
	}
	sidecar := filepath.Join(service.cacheDir, CacheKey(request)+"."+format+".timeline.json")
	content, err := os.ReadFile(sidecar)
	if err != nil {
		if os.IsNotExist(err) {
			return Timeline{}, nil
		}
		return Timeline{}, fmt.Errorf("read audio timeline: %w", err)
	}
	var timeline Timeline
	if err := json.Unmarshal(content, &timeline); err != nil {
		return Timeline{}, fmt.Errorf("decode audio timeline: %w", err)
	}
	return timeline, nil
}

func writeTimelineSidecar(root, cachePath string, timeline Timeline) error {
	sidecar := cachePath + ".timeline.json"
	content, err := json.Marshal(timeline)
	if err != nil {
		return err
	}
	temporary, err := os.CreateTemp(root, ".timeline-*")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	if _, err := temporary.Write(content); err != nil {
		_ = temporary.Close()
		_ = os.Remove(temporaryPath)
		return err
	}
	if err := temporary.Close(); err != nil {
		_ = os.Remove(temporaryPath)
		return err
	}
	if err := os.Rename(temporaryPath, sidecar); err != nil {
		_ = os.Remove(temporaryPath)
		return err
	}
	return nil
}

func (service *Service) Open(ctx context.Context, request Request) (*Opened, error) {
	return service.openResolved(service.Resolve(ctx, request))
}

// OpenExisting opens local or cached audio without invoking a generator.
func (service *Service) OpenExisting(ctx context.Context, request Request) (*Opened, error) {
	return service.openResolved(service.ResolveExisting(ctx, request))
}

func (service *Service) openResolved(asset Asset, err error) (*Opened, error) {
	if err != nil {
		return nil, err
	}
	root := service.cacheDir
	if asset.Source == SourceLocal {
		root = service.localDir
	}
	if err := ensureSecureRegularFile(root, asset.Path); err != nil {
		return nil, err
	}
	file, err := os.Open(asset.Path)
	if err != nil {
		return nil, fmt.Errorf("open audio asset: %w", err)
	}
	return &Opened{Asset: asset, File: file}, nil
}

func IsRecoverable(err error) bool {
	return errors.Is(err, ErrNotFound) ||
		errors.Is(err, ErrGeneratorUnavailable) ||
		errors.Is(err, ErrUnsupportedFormat)
}

func (service *Service) resolveLocalPath(request Request) (string, bool, error) {
	if request.LocalPath != "" {
		path, err := secureJoin(service.localDir, request.LocalPath)
		if err != nil {
			return "", false, err
		}
		if err := ensureSecureRegularFile(service.localDir, path); err != nil {
			if errors.Is(err, os.ErrNotExist) {
				return "", false, nil
			}
			return "", false, err
		}
		return path, true, nil
	}
	filename := safeTermFilename(request.Term)
	if filename == "" {
		return "", false, nil
	}
	for _, extension := range []string{".mp3", ".wav", ".ogg", ".m4a", ".aac", ".flac"} {
		candidate := filepath.Join(service.localDir, filename+extension)
		if err := ensureSecureRegularFile(service.localDir, candidate); err == nil {
			return candidate, true, nil
		} else if !errors.Is(err, os.ErrNotExist) {
			return "", false, err
		}
	}
	return "", false, nil
}

func inspectSecureAsset(root, path, key string, source Source) (Asset, error) {
	if err := ensureSecureRegularFile(root, path); err != nil {
		return Asset{}, err
	}
	return inspectAsset(path, key, source)
}

func inspectAsset(path, key string, source Source) (Asset, error) {
	info, err := os.Stat(path)
	if err != nil {
		return Asset{}, err
	}
	mimeType, err := mimeForPath(path)
	if err != nil {
		return Asset{}, err
	}
	return Asset{
		Key:     key,
		Path:    path,
		Name:    filepath.Base(path),
		MIME:    mimeType,
		Size:    info.Size(),
		ModTime: info.ModTime().UTC(),
		Source:  source,
	}, nil
}

func ensureSecureRegularFile(root, path string) error {
	if _, err := secureJoin(root, mustRelative(root, path)); err != nil {
		return err
	}
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("%w: symbolic link", ErrUnsafePath)
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("%w: not a regular file", ErrUnsafePath)
	}
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil {
		return err
	}
	if !pathWithin(root, resolved) {
		return fmt.Errorf("%w: resolved file escapes root", ErrUnsafePath)
	}
	return nil
}

func secureJoin(root, relative string) (string, error) {
	if filepath.IsAbs(relative) {
		return "", fmt.Errorf("%w: absolute path", ErrUnsafePath)
	}
	cleaned := filepath.Clean(relative)
	if cleaned == "." || cleaned == "" || cleaned == ".." || strings.HasPrefix(cleaned, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("%w: path traversal", ErrUnsafePath)
	}
	joined := filepath.Join(root, cleaned)
	if !pathWithin(root, joined) {
		return "", fmt.Errorf("%w: path escapes root", ErrUnsafePath)
	}
	return joined, nil
}

func mustRelative(root, path string) string {
	relative, err := filepath.Rel(root, path)
	if err != nil {
		return ".."
	}
	return relative
}

func pathWithin(root, path string) bool {
	root = filepath.Clean(root)
	path = filepath.Clean(path)
	relative, err := filepath.Rel(root, path)
	return err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator))
}

func cleanRoot(root string) (string, error) {
	if strings.TrimSpace(root) == "" {
		return "", errors.New("path is empty")
	}
	absolute, err := filepath.Abs(root)
	if err != nil {
		return "", err
	}
	return filepath.Clean(absolute), nil
}

func normalizeRequest(request Request) Request {
	request.Term = strings.ToLower(strings.Join(strings.Fields(request.Term), " "))
	request.Locale = strings.ToLower(strings.TrimSpace(request.Locale))
	request.Voice = strings.ToLower(strings.TrimSpace(request.Voice))
	request.Format = strings.TrimPrefix(strings.ToLower(strings.TrimSpace(request.Format)), ".")
	request.Provider = strings.ToLower(strings.TrimSpace(request.Provider))
	request.LocalPath = strings.TrimSpace(request.LocalPath)
	return request
}

func normalizedFormat(format string) (string, error) {
	format = strings.TrimPrefix(strings.ToLower(strings.TrimSpace(format)), ".")
	if format == "" {
		return "wav", nil
	}
	switch format {
	case "wav", "mp3", "ogg", "m4a", "aac", "flac":
		return format, nil
	default:
		return "", fmt.Errorf("%w: %s", ErrUnsupportedFormat, format)
	}
}

func mimeForPath(path string) (string, error) {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".wav":
		return "audio/wav", nil
	case ".mp3":
		return "audio/mpeg", nil
	case ".ogg":
		return "audio/ogg", nil
	case ".m4a":
		return "audio/mp4", nil
	case ".aac":
		return "audio/aac", nil
	case ".flac":
		return "audio/flac", nil
	default:
		if detected := mime.TypeByExtension(filepath.Ext(path)); strings.HasPrefix(detected, "audio/") {
			return strings.Split(detected, ";")[0], nil
		}
		return "", fmt.Errorf("%w: %s", ErrUnsupportedFormat, filepath.Ext(path))
	}
}

func safeTermFilename(term string) string {
	var builder strings.Builder
	for _, character := range strings.ToLower(strings.TrimSpace(term)) {
		switch {
		case character >= 'a' && character <= 'z', character >= '0' && character <= '9':
			builder.WriteRune(character)
		case character == ' ', character == '-', character == '_', character == '.':
			builder.WriteRune('_')
		}
	}
	return strings.Trim(builder.String(), "_.")
}

var _ io.ReadSeekCloser = (*os.File)(nil)
