// Package launcher powers the PWA mode: a background server that serves the
// built web app, shuts down when the browser tab closes, checks GitHub
// releases for updates, and applies them with an automatic restart.
package launcher

import (
	"context"
	"net/http"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

type Service struct {
	StaticDir    string
	Repo         string
	AssetArch    string
	Version      string
	DataDir      string
	DownloadBase string
	APIBase      string
	HTTPClient   *http.Client

	OnShutdown func()
	OnRestart  func()

	mu       sync.Mutex
	cache    *Status
	cachedAt time.Time
	activity atomic.Int64
}

// defaultUpdateTimeout bounds a single call to the GitHub releases API.
var defaultUpdateTimeout = 20 * time.Second

// watchdogInterval is how often the idle check runs. A var so tests do not have
// to wait a real minute for the first tick.
var watchdogInterval = time.Minute

type Options struct {
	StaticDir string
	Repo      string
	Version   string
	DataDir   string
}

func NewService(options Options) *Service {
	arch := runtime.GOARCH
	if arch == "amd64" {
		arch = "x64"
	} else if arch == "arm64" {
		arch = "arm64"
	}
	repo := strings.TrimSpace(options.Repo)
	if repo == "" {
		repo = "dieWehmut/study-os"
	}
	service := &Service{
		StaticDir:  options.StaticDir,
		Repo:       repo,
		AssetArch:  arch,
		Version:    options.Version,
		DataDir:    options.DataDir,
		HTTPClient: http.DefaultClient,
		APIBase:    "https://api.github.com",
	}
	// Start the idle clock at boot. The zero value reads back as 1970, which
	// time.Since reports as decades of idleness, so the watchdog's first tick
	// would kill the server before the browser ever sent a request.
	service.Touch()
	return service
}

func (s *Service) Touch() {
	s.activity.Store(time.Now().Unix())
}

func (s *Service) LastActivity() time.Time {
	return time.Unix(s.activity.Load(), 0)
}

func (s *Service) Close() {
	if s.OnShutdown != nil {
		go s.OnShutdown()
	}
}

// Status returns the cached update status, refreshing at most once per hour.
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

// RunWatchdog shuts the server down after idleDuration without any request
// activity, so a closed browser tab leaves no background process behind.
func (s *Service) RunWatchdog(ctx context.Context, idle time.Duration) {
	if idle <= 0 {
		return
	}
	ticker := time.NewTicker(watchdogInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if time.Since(s.LastActivity()) > idle {
				s.Close()
				return
			}
		}
	}
}
