package backup

import (
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"time"
)

// A restore cannot happen while the app is running.
//
// The store is open, every handler holds `application.Store`, and swapping that
// pointer under them is a data race; replacing the file under an open connection
// is worse. So the request is recorded now and carried out at the one moment when
// nobody holds the database: before it is opened, on the next start.
//
// Everything here is a file in the data directory, because that is all there is
// before the store exists. A malformed or missing request means "no restore" --
// never a failed start.
const (
	restoreRequestName = "restore-request.json"
	restoreOutcomeName = "restore-outcome.json"
)

// RestoreRequest is the note the running app leaves for its next start.
type RestoreRequest struct {
	Path        string    `json:"path"`
	RequestedAt time.Time `json:"requested_at"`
}

// RestoreOutcome is what the start that carried it out has to say, so the page
// can report a restore that failed instead of silently not having happened.
type RestoreOutcome struct {
	OK         bool      `json:"ok"`
	Path       string    `json:"path"`
	Detail     string    `json:"detail,omitempty"`
	ResolvedAt time.Time `json:"resolved_at"`
}

func requestPath(dataDir string) string { return filepath.Join(dataDir, restoreRequestName) }

func outcomePath(dataDir string) string { return filepath.Join(dataDir, restoreOutcomeName) }

// WriteRestoreRequest records which backup to restore at the next start.
func WriteRestoreRequest(dataDir, backupPath string) error {
	if dataDir == "" || backupPath == "" {
		return errors.New("restore request needs a data directory and a backup path")
	}
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return err
	}
	payload, err := json.Marshal(RestoreRequest{Path: backupPath, RequestedAt: time.Now().UTC()})
	if err != nil {
		return err
	}
	return os.WriteFile(requestPath(dataDir), payload, 0o600)
}

// ReadRestoreRequest answers the backup to restore, or false when there is none.
// A file that cannot be read or parsed is treated as no request: a corrupt note
// must not be able to stop the app from starting.
func ReadRestoreRequest(dataDir string) (string, bool) {
	if dataDir == "" {
		return "", false
	}
	payload, err := os.ReadFile(requestPath(dataDir))
	if err != nil {
		return "", false
	}
	var request RestoreRequest
	if err := json.Unmarshal(payload, &request); err != nil || request.Path == "" {
		return "", false
	}
	return request.Path, true
}

// ClearRestoreRequest forgets the request, whatever came of it.
func ClearRestoreRequest(dataDir string) error {
	err := os.Remove(requestPath(dataDir))
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	return err
}

// WriteRestoreOutcome records what happened, for the page to read afterwards.
func WriteRestoreOutcome(dataDir string, outcome RestoreOutcome) error {
	if dataDir == "" {
		return errors.New("restore outcome needs a data directory")
	}
	outcome.ResolvedAt = time.Now().UTC()
	payload, err := json.Marshal(outcome)
	if err != nil {
		return err
	}
	return os.WriteFile(outcomePath(dataDir), payload, 0o600)
}

// ReadRestoreOutcome answers the last restore, or false when there was none.
func ReadRestoreOutcome(dataDir string) (RestoreOutcome, bool) {
	if dataDir == "" {
		return RestoreOutcome{}, false
	}
	payload, err := os.ReadFile(outcomePath(dataDir))
	if err != nil {
		return RestoreOutcome{}, false
	}
	var outcome RestoreOutcome
	if err := json.Unmarshal(payload, &outcome); err != nil {
		return RestoreOutcome{}, false
	}
	return outcome, true
}

// ClearRestoreOutcome forgets the last outcome.
func ClearRestoreOutcome(dataDir string) error {
	err := os.Remove(outcomePath(dataDir))
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	return err
}
