// Package backup creates verified, retention-managed copies of the local SQLite
// database. It deliberately has no dependency on the HTTP or application
// packages so startup and update code can invoke it without creating cycles.
package backup

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	_ "modernc.org/sqlite"
)

// Category controls retention independently for routine and update backups.
type Category string

const (
	Daily     Category = "daily"
	PreUpdate Category = "pre-update"
)

// Result describes a published backup. The checksum is useful to release and
// update tooling without requiring another read of the file.
type Result struct {
	Path      string    `json:"path"`
	Category  Category  `json:"category"`
	CreatedAt time.Time `json:"created_at"`
	Size      int64     `json:"size"`
	SHA256    string    `json:"sha256"`
}

type Service struct {
	root      string
	clock     func() time.Time
	retention map[Category]int
	sequence  uint64
}

type Option func(*Service)

// WithClock makes backup naming and tests deterministic.
func WithClock(clock func() time.Time) Option {
	return func(s *Service) {
		if clock != nil {
			s.clock = clock
		}
	}
}

// WithRetention overrides the number of copies retained for one category.
func WithRetention(category Category, count int) Option {
	return func(s *Service) {
		if count >= 0 {
			s.retention[category] = count
		}
	}
}

func NewService(root string, options ...Option) *Service {
	s := &Service{
		root:  root,
		clock: time.Now,
		retention: map[Category]int{
			Daily:     14,
			PreUpdate: 5,
		},
	}
	for _, option := range options {
		if option != nil {
			option(s)
		}
	}
	return s
}

// Create snapshots source into a temporary file, verifies the resulting
// SQLite database, atomically publishes it, then applies category retention.
func (s *Service) Create(ctx context.Context, source string, category Category) (Result, error) {
	if s == nil {
		return Result{}, errors.New("backup service is nil")
	}
	if err := ctx.Err(); err != nil {
		return Result{}, err
	}
	if category != Daily && category != PreUpdate {
		return Result{}, fmt.Errorf("unsupported backup category %q", category)
	}
	source, err := filepath.Abs(source)
	if err != nil {
		return Result{}, fmt.Errorf("resolve source: %w", err)
	}
	if info, err := os.Stat(source); err != nil {
		return Result{}, fmt.Errorf("stat source: %w", err)
	} else if !info.Mode().IsRegular() {
		return Result{}, fmt.Errorf("source is not a regular file: %s", source)
	}
	if err := VerifySQLite(source); err != nil {
		return Result{}, fmt.Errorf("verify source: %w", err)
	}

	destinationDir := filepath.Join(s.root, string(category))
	if err := os.MkdirAll(destinationDir, 0o700); err != nil {
		return Result{}, fmt.Errorf("create backup directory: %w", err)
	}
	now := s.clock().UTC()
	sequence := atomic.AddUint64(&s.sequence, 1)
	name := fmt.Sprintf("study-%s-%s-%06d.db", category, now.Format("20060102T150405.000000000Z"), sequence)
	destination := filepath.Join(destinationDir, name)
	temporary, err := os.CreateTemp(destinationDir, ".backup-*.tmp")
	if err != nil {
		return Result{}, fmt.Errorf("create temporary backup: %w", err)
	}
	temporaryPath := temporary.Name()
	if err := temporary.Close(); err != nil {
		_ = os.Remove(temporaryPath)
		return Result{}, fmt.Errorf("close temporary backup: %w", err)
	}
	if err := os.Remove(temporaryPath); err != nil {
		return Result{}, fmt.Errorf("remove temporary placeholder: %w", err)
	}
	if err := snapshotSQLite(ctx, source, temporaryPath); err != nil {
		_ = os.Remove(temporaryPath)
		return Result{}, err
	}
	if err := VerifySQLite(temporaryPath); err != nil {
		_ = os.Remove(temporaryPath)
		return Result{}, fmt.Errorf("verify generated backup: %w", err)
	}
	if err := os.Rename(temporaryPath, destination); err != nil {
		_ = os.Remove(temporaryPath)
		return Result{}, fmt.Errorf("publish backup: %w", err)
	}

	result, err := describe(destination, category, now)
	if err != nil {
		_ = os.Remove(destination)
		return Result{}, err
	}
	if err := s.Prune(category); err != nil {
		return Result{}, err
	}
	return result, nil
}

// CreateDailyIfNeeded creates at most one valid routine backup for each UTC day.
func (s *Service) CreateDailyIfNeeded(ctx context.Context, source string) (Result, bool, error) {
	if s == nil {
		return Result{}, false, errors.New("backup service is nil")
	}
	today := s.clock().UTC().Format("20060102")
	dir := filepath.Join(s.root, string(Daily))
	entries, err := os.ReadDir(dir)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return Result{}, false, fmt.Errorf("list daily backups: %w", err)
	}
	if err == nil {
		prefix := "study-" + string(Daily) + "-" + today
		for _, entry := range entries {
			if entry.IsDir() || filepath.Ext(entry.Name()) != ".db" || !strings.HasPrefix(entry.Name(), prefix) {
				continue
			}
			path := filepath.Join(dir, entry.Name())
			if err := VerifySQLite(path); err != nil {
				continue
			}
			info, err := entry.Info()
			if err != nil {
				return Result{}, false, fmt.Errorf("stat daily backup: %w", err)
			}
			result, err := describe(path, Daily, info.ModTime().UTC())
			return result, false, err
		}
	}
	result, err := s.Create(ctx, source, Daily)
	return result, err == nil, err
}

// Restore verifies a published SQLite backup and atomically replaces the
// destination database. The old destination is kept until the replacement is
// verified, so a failed restore can roll back without leaving a partial file.
func (s *Service) Restore(ctx context.Context, backupPath, destination string) error {
	if s == nil {
		return errors.New("backup service is nil")
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	backupPath, err := filepath.Abs(backupPath)
	if err != nil {
		return fmt.Errorf("resolve backup path: %w", err)
	}
	destination, err = filepath.Abs(destination)
	if err != nil {
		return fmt.Errorf("resolve destination path: %w", err)
	}
	if samePath(backupPath, destination) {
		return errors.New("backup and destination paths must differ")
	}
	if s.root != "" {
		root, rootErr := filepath.Abs(s.root)
		if rootErr != nil {
			return fmt.Errorf("resolve backup root: %w", rootErr)
		}
		rootPrefix := filepath.Clean(root) + string(os.PathSeparator)
		if !strings.HasPrefix(strings.ToLower(backupPath), strings.ToLower(rootPrefix)) {
			return errors.New("backup path is outside the backup root")
		}
	}
	if err := verifyRegularFile(backupPath, "backup"); err != nil {
		return err
	}
	if err := VerifySQLite(backupPath); err != nil {
		return fmt.Errorf("verify backup: %w", err)
	}

	destinationDir := filepath.Dir(destination)
	if err := os.MkdirAll(destinationDir, 0o700); err != nil {
		return fmt.Errorf("create destination directory: %w", err)
	}
	if info, err := os.Lstat(destination); err == nil {
		if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
			return fmt.Errorf("destination is not a regular file: %s", destination)
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("inspect destination: %w", err)
	}

	temporary, err := os.CreateTemp(destinationDir, ".study-restore-*.tmp")
	if err != nil {
		return fmt.Errorf("create restore temporary: %w", err)
	}
	temporaryPath := temporary.Name()
	cleanupTemporary := true
	defer func() {
		if cleanupTemporary {
			_ = os.Remove(temporaryPath)
		}
	}()
	if err := temporary.Chmod(0o600); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("secure restore temporary: %w", err)
	}
	if err := copyFile(ctx, temporary, backupPath); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("sync restore temporary: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close restore temporary: %w", err)
	}
	if err := VerifySQLite(temporaryPath); err != nil {
		return fmt.Errorf("verify restore temporary: %w", err)
	}

	oldPath, hadDestination, err := moveDestinationAside(destinationDir, destination)
	if err != nil {
		return err
	}
	if err := os.Rename(temporaryPath, destination); err != nil {
		if hadDestination {
			_ = os.Rename(oldPath, destination)
		}
		return fmt.Errorf("publish restored database: %w", err)
	}
	cleanupTemporary = false
	if err := VerifySQLite(destination); err != nil {
		_ = os.Remove(destination)
		if hadDestination {
			_ = os.Rename(oldPath, destination)
		}
		return fmt.Errorf("verify restored database: %w", err)
	}
	if hadDestination {
		if err := os.Remove(oldPath); err != nil {
			return fmt.Errorf("remove previous database after restore: %w", err)
		}
	}
	return nil
}

func verifyRegularFile(path, label string) error {
	info, err := os.Lstat(path)
	if err != nil {
		return fmt.Errorf("stat %s: %w", label, err)
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return fmt.Errorf("%s is not a regular file: %s", label, path)
	}
	return nil
}

func samePath(left, right string) bool {
	left = filepath.Clean(left)
	right = filepath.Clean(right)
	if equal := strings.EqualFold(left, right); equal {
		return true
	}
	leftInfo, leftErr := os.Stat(left)
	rightInfo, rightErr := os.Stat(right)
	return leftErr == nil && rightErr == nil && os.SameFile(leftInfo, rightInfo)
}

func copyFile(ctx context.Context, destination *os.File, sourcePath string) error {
	source, err := os.Open(sourcePath)
	if err != nil {
		return fmt.Errorf("open backup for restore: %w", err)
	}
	defer source.Close()
	buffer := make([]byte, 1024*1024)
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		read, readErr := source.Read(buffer)
		if read > 0 {
			written := 0
			for written < read {
				count, writeErr := destination.Write(buffer[written:read])
				written += count
				if writeErr != nil {
					return fmt.Errorf("write restore temporary: %w", writeErr)
				}
			}
		}
		if errors.Is(readErr, io.EOF) {
			return nil
		}
		if readErr != nil {
			return fmt.Errorf("read backup for restore: %w", readErr)
		}
	}
}

func moveDestinationAside(destinationDir, destination string) (string, bool, error) {
	if _, err := os.Lstat(destination); errors.Is(err, os.ErrNotExist) {
		return "", false, nil
	} else if err != nil {
		return "", false, fmt.Errorf("inspect destination before restore: %w", err)
	}
	temporary, err := os.CreateTemp(destinationDir, ".study-restore-old-*.tmp")
	if err != nil {
		return "", false, fmt.Errorf("create restore rollback marker: %w", err)
	}
	oldPath := temporary.Name()
	if err := temporary.Close(); err != nil {
		_ = os.Remove(oldPath)
		return "", false, fmt.Errorf("close restore rollback marker: %w", err)
	}
	if err := os.Remove(oldPath); err != nil {
		return "", false, fmt.Errorf("remove restore rollback marker: %w", err)
	}
	if err := os.Rename(destination, oldPath); err != nil {
		return "", false, fmt.Errorf("move previous database aside: %w", err)
	}
	return oldPath, true, nil
}

func snapshotSQLite(ctx context.Context, source, destinationPath string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	// VACUUM INTO asks SQLite to produce a transactionally consistent snapshot,
	// including databases that currently have a WAL sidecar.
	db, err := sql.Open("sqlite", source)
	if err != nil {
		return fmt.Errorf("open source for snapshot: %w", err)
	}
	defer db.Close()
	if err := db.PingContext(ctx); err != nil {
		return fmt.Errorf("ping source for snapshot: %w", err)
	}

	quoted := strings.ReplaceAll(destinationPath, "'", "''")
	if _, err := db.ExecContext(ctx, "VACUUM INTO '"+quoted+"'"); err != nil {
		return fmt.Errorf("snapshot sqlite database: %w", err)
	}
	return nil
}

// VerifySQLite opens a database read-only and runs SQLite's integrity check.
func VerifySQLite(path string) error {
	if path == "" {
		return errors.New("sqlite path is empty")
	}
	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	if info.Size() == 0 {
		return errors.New("sqlite file is empty")
	}
	db, err := sql.Open("sqlite", path+"?mode=ro")
	if err != nil {
		return fmt.Errorf("open sqlite file: %w", err)
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var result string
	if err := db.QueryRowContext(ctx, "PRAGMA integrity_check").Scan(&result); err != nil {
		return fmt.Errorf("run integrity check: %w", err)
	}
	if !strings.EqualFold(strings.TrimSpace(result), "ok") {
		return fmt.Errorf("sqlite integrity check: %s", result)
	}
	return nil
}

// Prune keeps the newest configured number of published copies for category.
func (s *Service) Prune(category Category) error {
	limit, ok := s.retention[category]
	if !ok {
		return fmt.Errorf("unsupported backup category %q", category)
	}
	dir := filepath.Join(s.root, string(category))
	entries, err := os.ReadDir(dir)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("list backups: %w", err)
	}
	type fileEntry struct {
		name string
		mod  time.Time
	}
	files := make([]fileEntry, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".db" {
			continue
		}
		info, infoErr := entry.Info()
		if infoErr != nil {
			return fmt.Errorf("stat backup %s: %w", entry.Name(), infoErr)
		}
		files = append(files, fileEntry{name: entry.Name(), mod: info.ModTime()})
	}
	sort.Slice(files, func(i, j int) bool {
		if files[i].mod.Equal(files[j].mod) {
			return files[i].name > files[j].name
		}
		return files[i].mod.After(files[j].mod)
	})
	for _, file := range files[minInt(limit, len(files)):] {
		if err := os.Remove(filepath.Join(dir, file.name)); err != nil {
			return fmt.Errorf("remove expired backup %s: %w", file.name, err)
		}
	}
	return nil
}

func describe(path string, category Category, createdAt time.Time) (Result, error) {
	info, err := os.Stat(path)
	if err != nil {
		return Result{}, fmt.Errorf("stat published backup: %w", err)
	}
	hash, err := fileSHA256(path)
	if err != nil {
		return Result{}, fmt.Errorf("hash published backup: %w", err)
	}
	return Result{Path: path, Category: category, CreatedAt: createdAt, Size: info.Size(), SHA256: hash}, nil
}

func fileSHA256(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// ParseRetention is a small helper for environment/configuration adapters.
func ParseRetention(value string, fallback int) int {
	n, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || n < 0 {
		return fallback
	}
	return n
}
