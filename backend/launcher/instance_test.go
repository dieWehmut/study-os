package launcher

import (
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestListenFallsBackToNextFreePort(t *testing.T) {
	taken, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("occupy port: %v", err)
	}
	defer taken.Close()

	listener, err := Listen(taken.Addr().String(), 10)
	if err != nil {
		t.Fatalf("Listen: %v", err)
	}
	defer listener.Close()

	if listener.Addr().String() == taken.Addr().String() {
		t.Fatalf("Listen reused the occupied address %q", taken.Addr())
	}
	_, basePort, _ := net.SplitHostPort(taken.Addr().String())
	_, gotPort, _ := net.SplitHostPort(listener.Addr().String())
	if gotPort <= basePort {
		t.Fatalf("Listen picked port %s, want a port above %s", gotPort, basePort)
	}
}

func TestListenFailsWhenWholeSpanIsTaken(t *testing.T) {
	first, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("occupy port: %v", err)
	}
	defer first.Close()

	if _, err := Listen(first.Addr().String(), 1); err == nil {
		t.Fatal("Listen succeeded even though the only port in the span was taken")
	}
}

func TestAddressFileRoundTrip(t *testing.T) {
	dataDir := t.TempDir()
	if got, ok := ReadAddress(dataDir); ok {
		t.Fatalf("ReadAddress on empty dir returned %q", got)
	}
	if err := WriteAddress(dataDir, "127.0.0.1:8422"); err != nil {
		t.Fatalf("WriteAddress: %v", err)
	}
	got, ok := ReadAddress(dataDir)
	if !ok || got != "127.0.0.1:8422" {
		t.Fatalf("ReadAddress = %q, %v; want 127.0.0.1:8422, true", got, ok)
	}
	RemoveAddress(dataDir)
	if _, ok := ReadAddress(dataDir); ok {
		t.Fatal("ReadAddress still reports an address after RemoveAddress")
	}
}

func TestWriteAddressCreatesMissingDataDir(t *testing.T) {
	dataDir := filepath.Join(t.TempDir(), "nested", "data")
	if err := WriteAddress(dataDir, "127.0.0.1:8422"); err != nil {
		t.Fatalf("WriteAddress: %v", err)
	}
	if _, ok := ReadAddress(dataDir); !ok {
		t.Fatal("address file was not created")
	}
}

// A stale address file must never be mistaken for a live sibling, and a plain
// API-only backend on the recorded port must not be either: LiveInstance keys
// off the frontend actually being served.
func TestLiveInstance(t *testing.T) {
	appServer := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/" {
			_, _ = response.Write([]byte("<!doctype html>"))
			return
		}
		http.NotFound(response, request)
	}))
	defer appServer.Close()

	apiOnlyServer := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/api/health" {
			_, _ = response.Write([]byte(`{"status":"ok"}`))
			return
		}
		http.NotFound(response, request)
	}))
	defer apiOnlyServer.Close()

	tests := []struct {
		name    string
		address string
		want    bool
	}{
		{"serves the app", strings.TrimPrefix(appServer.URL, "http://"), true},
		{"api only backend", strings.TrimPrefix(apiOnlyServer.URL, "http://"), false},
		{"nothing listening", "127.0.0.1:1", false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			dataDir := t.TempDir()
			if err := WriteAddress(dataDir, test.address); err != nil {
				t.Fatalf("WriteAddress: %v", err)
			}
			if got, _ := LiveInstance(dataDir); got != test.want {
				t.Fatalf("LiveInstance = %v, want %v", got, test.want)
			}
		})
	}

	t.Run("no address file", func(t *testing.T) {
		if got, _ := LiveInstance(t.TempDir()); got {
			t.Fatal("LiveInstance reported a live instance without an address file")
		}
	})
}

func TestLiveInstanceReturnsRecordedAddress(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		_, _ = response.Write([]byte("<!doctype html>"))
	}))
	defer server.Close()

	dataDir := t.TempDir()
	address := strings.TrimPrefix(server.URL, "http://")
	if err := WriteAddress(dataDir, address); err != nil {
		t.Fatalf("WriteAddress: %v", err)
	}
	live, got := LiveInstance(dataDir)
	if !live || got != address {
		t.Fatalf("LiveInstance = %v, %q; want true, %q", live, got, address)
	}
}

func TestReadAddressIgnoresBlankFile(t *testing.T) {
	dataDir := t.TempDir()
	if err := os.WriteFile(AddressPath(dataDir), []byte("  \n"), 0o600); err != nil {
		t.Fatalf("write blank address file: %v", err)
	}
	if got, ok := ReadAddress(dataDir); ok {
		t.Fatalf("ReadAddress on blank file returned %q", got)
	}
}
