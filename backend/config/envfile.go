package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const activeProviderKey = "AI_ACTIVE_PROVIDER"

// allowedEnvKeys limits which settings the application is allowed to rewrite.
// Secrets are written locally but never returned by any API.
var allowedEnvKeys = map[string]bool{
	activeProviderKey:          true,
	"DEEPSEEK_API_KEY":         true,
	"DEEPSEEK_BASE_URL":        true,
	"DEEPSEEK_MODEL":           true,
	"DEEPSEEK_REASONING_MODEL": true,
	"DASHSCOPE_API_KEY":        true,
	"DASHSCOPE_TTS_VOICE":      true,
}

// SetActiveProvider rewrites only the AI_ACTIVE_PROVIDER line of the local
// environment file, preserving every other line and comment.
func SetActiveProvider(path, provider string) error {
	provider = strings.TrimSpace(provider)
	if provider == "" {
		return fmt.Errorf("active provider is empty")
	}
	if !knownImplementedProvider(provider) {
		return fmt.Errorf("unsupported active provider %q", provider)
	}
	return UpdateEnvFile(path, map[string]string{activeProviderKey: provider})
}

// UpdateEnvFile applies key/value updates to the local environment file:
// existing keys are replaced in place (or removed when the value is empty),
// missing keys are appended, and all unrelated lines are preserved. The
// previous file content is kept next to it as <path>.bak before an atomic
// replace. Unknown keys are rejected before any write happens.
func UpdateEnvFile(path string, values map[string]string) error {
	if len(values) == 0 {
		return fmt.Errorf("no env values to update")
	}
	if strings.TrimSpace(path) == "" {
		return fmt.Errorf("env file path is empty")
	}
	for key := range values {
		if !allowedEnvKeys[key] {
			return fmt.Errorf("unsupported env key %q", key)
		}
	}

	lines := make([]string, 0)
	original, err := os.ReadFile(path)
	switch {
	case err == nil:
		if err := os.WriteFile(path+".bak", original, 0o600); err != nil {
			return fmt.Errorf("backup env file %q: %w", path, err)
		}
		lines = splitLines(string(original))
	case os.IsNotExist(err):
		lines = nil
	default:
		return fmt.Errorf("read env file %q: %w", path, err)
	}

	remove := make(map[int]bool)
	for key, value := range values {
		replaced := false
		for index, line := range lines {
			lineKey, _, found := strings.Cut(stripExport(strings.TrimSpace(line)), "=")
			if found && strings.TrimSpace(lineKey) == key {
				if strings.TrimSpace(value) == "" {
					remove[index] = true
				} else {
					lines[index] = key + "=" + value
				}
				replaced = true
				break
			}
		}
		if !replaced && strings.TrimSpace(value) != "" {
			lines = append(lines, key+"="+value)
		}
	}
	if len(remove) > 0 {
		kept := make([]string, 0, len(lines))
		for index, line := range lines {
			if !remove[index] {
				kept = append(kept, line)
			}
		}
		lines = kept
	}

	content := strings.Join(lines, "\n")
	if content != "" && !strings.HasSuffix(content, "\n") {
		content += "\n"
	}

	directory := filepath.Dir(path)
	temporary, err := os.CreateTemp(directory, ".env-local-*")
	if err != nil {
		return fmt.Errorf("create temporary env file: %w", err)
	}
	temporaryPath := temporary.Name()
	if _, err := temporary.WriteString(content); err != nil {
		_ = temporary.Close()
		_ = os.Remove(temporaryPath)
		return fmt.Errorf("write temporary env file: %w", err)
	}
	if err := temporary.Close(); err != nil {
		_ = os.Remove(temporaryPath)
		return fmt.Errorf("close temporary env file: %w", err)
	}
	if err := os.Chmod(temporaryPath, 0o600); err != nil {
		_ = os.Remove(temporaryPath)
		return fmt.Errorf("secure temporary env file: %w", err)
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		_ = os.Remove(temporaryPath)
		return fmt.Errorf("replace env file %q: %w", path, err)
	}
	return nil
}

func knownImplementedProvider(provider string) bool {
	switch provider {
	case "mock", "deepseek":
		return true
	default:
		return false
	}
}

func stripExport(line string) string {
	return strings.TrimSpace(strings.TrimPrefix(line, "export "))
}

func splitLines(value string) []string {
	value = strings.ReplaceAll(value, "\r\n", "\n")
	value = strings.ReplaceAll(value, "\r", "\n")
	if value == "" {
		return nil
	}
	lines := strings.Split(value, "\n")
	if len(lines) > 0 && lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}
	return lines
}
