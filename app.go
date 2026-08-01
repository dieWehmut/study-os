package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	backendapp "study-os/backend/app"
	"study-os/backend/config"
	"study-os/backend/httpapi"
)

// DesktopApp owns the loopback server and backend application for exactly the
// lifetime of the Wails window.
type DesktopApp struct {
	mu          sync.RWMutex
	application *backendapp.App
	server      *http.Server
	listener    net.Listener
	apiBaseURL  string
	apiToken    string
	startErr    error
	stopOnce    sync.Once
}

func NewDesktopApp() *DesktopApp {
	return &DesktopApp{}
}

func (a *DesktopApp) Startup(ctx context.Context) {
	a.mu.Lock()
	defer a.mu.Unlock()

	cfg, err := config.Load()
	if err != nil {
		a.startErr = fmt.Errorf("load desktop configuration: %w", err)
		return
	}
	dataDir, err := desktopDataDir(cfg.DataDir)
	if err != nil {
		a.startErr = err
		return
	}
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		a.startErr = fmt.Errorf("create desktop data directory: %w", err)
		return
	}
	dbPath := cfg.DBPath
	if !filepath.IsAbs(dbPath) {
		dbPath = filepath.Join(dataDir, filepath.Base(dbPath))
	}
	cfg.DataDir = dataDir
	cfg.DBPath = dbPath
	cfg.ListenAddress = "127.0.0.1:0"

	application, err := backendapp.New(ctx, backendapp.Options{Config: cfg, DBPath: dbPath, DataDir: dataDir})
	if err != nil {
		a.startErr = fmt.Errorf("create backend: %w", err)
		return
	}
	listener, err := net.Listen("tcp", cfg.ListenAddress)
	if err != nil {
		_ = application.Close()
		a.startErr = fmt.Errorf("listen on loopback: %w", err)
		return
	}
	token, err := randomBearerToken()
	if err != nil {
		_ = listener.Close()
		_ = application.Close()
		a.startErr = err
		return
	}

	baseHandler := httpapi.NewRouter(application)
	server := &http.Server{
		Handler:           desktopAPIHandler(token, baseHandler),
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       30 * time.Second,
	}
	a.application = application
	a.listener = listener
	a.server = server
	a.apiBaseURL = "http://" + listener.Addr().String()
	a.apiToken = token
	go func() {
		if serveErr := server.Serve(listener); serveErr != nil && !errors.Is(serveErr, http.ErrServerClosed) {
			a.mu.Lock()
			if a.startErr == nil {
				a.startErr = fmt.Errorf("serve desktop API: %w", serveErr)
			}
			a.mu.Unlock()
		}
	}()
}

// APIBaseURL is called through the Wails bridge before the frontend creates its
// REST or SSE clients.
func (a *DesktopApp) APIBaseURL() (string, error) {
	a.mu.RLock()
	defer a.mu.RUnlock()
	if a.startErr != nil {
		return "", a.startErr
	}
	if a.apiBaseURL == "" {
		return "", errors.New("desktop API is not ready")
	}
	return a.apiBaseURL, nil
}

// APIToken is process-local and exists only to prevent unrelated local pages
// from issuing requests to the ephemeral loopback server.
func (a *DesktopApp) APIToken() (string, error) {
	a.mu.RLock()
	defer a.mu.RUnlock()
	if a.startErr != nil {
		return "", a.startErr
	}
	if a.apiToken == "" {
		return "", errors.New("desktop API token is not ready")
	}
	return a.apiToken, nil
}

func (a *DesktopApp) Shutdown(ctx context.Context) {
	a.stopOnce.Do(func() {
		a.mu.RLock()
		server := a.server
		application := a.application
		a.mu.RUnlock()
		if server != nil {
			shutdownCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
			_ = server.Shutdown(shutdownCtx)
			cancel()
		}
		if application != nil {
			_ = application.Close()
		}
	})
}

func desktopDataDir(configured string) (string, error) {
	if configured != "" && configured != "data" {
		return filepath.Abs(configured)
	}
	root, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("resolve user config directory: %w", err)
	}
	return filepath.Join(root, "StudyOS", "data"), nil
}

func randomBearerToken() (string, error) {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", fmt.Errorf("create desktop API token: %w", err)
	}
	return hex.EncodeToString(bytes), nil
}

func requireBearer(token string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+token {
			http.Error(w, http.StatusText(http.StatusUnauthorized), http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func desktopAPIHandler(token string, next http.Handler) http.Handler {
	authenticated := requireBearer(token, next)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" && origin != "http://wails.localhost" && origin != "wails://wails" {
			http.Error(w, http.StatusText(http.StatusForbidden), http.StatusForbidden)
			return
		}
		if origin != "" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
		}
		if r.Method == http.MethodOptions {
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
			w.Header().Set("Access-Control-Max-Age", "600")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		authenticated.ServeHTTP(w, r)
	})
}
