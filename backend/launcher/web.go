package launcher

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// SPAHandler serves the built web app and falls back to index.html for
// client-side routes (/knowledge, /memory, ...).
func (s *Service) SPAHandler() http.Handler {
	root := http.Dir(s.StaticDir)
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodGet && request.Method != http.MethodHead {
			http.NotFound(response, request)
			return
		}
		path := strings.TrimPrefix(request.URL.Path, "/")
		if path == "" {
			path = "index.html"
		}
		if strings.Contains(path, "..") {
			http.NotFound(response, request)
			return
		}
		if file, err := root.Open(path); err == nil {
			_ = file.Close()
			http.FileServer(root).ServeHTTP(response, request)
			return
		}
		index := filepath.Join(s.StaticDir, "index.html")
		if _, err := os.Stat(index); err != nil {
			http.NotFound(response, request)
			return
		}
		http.ServeFile(response, request, index)
	})
}
