package launcher

import (
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// DefaultPortSpan is how many consecutive ports Listen probes before giving up.
const DefaultPortSpan = 10

const addressFileName = "launcher-address"

// AddressPath is the file recording the address the running launcher serves on.
// The start script reads it to learn which port won, and a second process reads
// it to detect a live sibling regardless of which port that sibling picked.
func AddressPath(dataDir string) string {
	return filepath.Join(dataDir, addressFileName)
}

// Listen binds the first free port at or above the port in address, probing at
// most span consecutive ports. Walking keeps the launcher usable when something
// else already holds the preferred port.
func Listen(address string, span int) (net.Listener, error) {
	host, portText, err := net.SplitHostPort(address)
	if err != nil {
		return nil, fmt.Errorf("parse listen address %q: %w", address, err)
	}
	basePort, err := strconv.Atoi(portText)
	if err != nil {
		return nil, fmt.Errorf("parse listen port %q: %w", portText, err)
	}
	if span < 1 {
		span = 1
	}
	var lastErr error
	for offset := 0; offset < span; offset++ {
		port := basePort + offset
		if port > 65535 {
			break
		}
		candidate := net.JoinHostPort(host, strconv.Itoa(port))
		listener, err := net.Listen("tcp", candidate)
		if err == nil {
			return listener, nil
		}
		lastErr = err
	}
	return nil, fmt.Errorf("no free port in %d attempts from %s: %w", span, address, lastErr)
}

// WriteAddress records the address the launcher is serving on.
func WriteAddress(dataDir, address string) error {
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return fmt.Errorf("create data directory %q: %w", dataDir, err)
	}
	if err := os.WriteFile(AddressPath(dataDir), []byte(address), 0o600); err != nil {
		return fmt.Errorf("write launcher address: %w", err)
	}
	return nil
}

// ReadAddress returns the recorded address, if any.
func ReadAddress(dataDir string) (string, bool) {
	content, err := os.ReadFile(AddressPath(dataDir))
	if err != nil {
		return "", false
	}
	address := strings.TrimSpace(string(content))
	if address == "" {
		return "", false
	}
	return address, true
}

// RemoveAddress clears the record so the next start does not treat this
// instance as live.
func RemoveAddress(dataDir string) {
	_ = os.Remove(AddressPath(dataDir))
}

// LiveInstance reports whether another launcher instance is already serving the
// app, returning the address it is reachable at.
//
// Liveness is keyed on GET / answering 200 rather than on /api/health, because
// every study-os backend answers /api/health — including a development server
// that serves no frontend. Probing the frontend asks the question the caller
// actually has: can this address show the user the app?
func LiveInstance(dataDir string) (bool, string) {
	address, ok := ReadAddress(dataDir)
	if !ok {
		return false, ""
	}
	client := &http.Client{Timeout: 2 * time.Second}
	response, err := client.Get("http://" + address + "/")
	if err != nil {
		return false, ""
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return false, ""
	}
	return true, address
}
