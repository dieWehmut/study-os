package config_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"study-os/backend/config"
)

func TestUpdateEnvFileReplacesAndPreservesUnrelatedLines(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".env.local")
	contents := "# keep\nAI_ACTIVE_PROVIDER=mock\nDEEPSEEK_MODEL=old-model\nDEEPSEEK_API_KEY=\n"
	if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
		t.Fatalf("write env file: %v", err)
	}
	err := config.UpdateEnvFile(path, map[string]string{
		"DEEPSEEK_API_KEY": "sk-new",
		"DEEPSEEK_MODEL":   "deepseek-v4-flash",
	})
	if err != nil {
		t.Fatalf("update env file: %v", err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read env file: %v", err)
	}
	text := string(got)
	if !strings.Contains(text, "DEEPSEEK_API_KEY=sk-new") {
		t.Fatalf("key not updated:\n%s", text)
	}
	if !strings.Contains(text, "DEEPSEEK_MODEL=deepseek-v4-flash") {
		t.Fatalf("model not updated:\n%s", text)
	}
	if !strings.Contains(text, "# keep") || !strings.Contains(text, "AI_ACTIVE_PROVIDER=mock") {
		t.Fatalf("unrelated lines changed:\n%s", text)
	}
	backup, err := os.ReadFile(path + ".bak")
	if err != nil {
		t.Fatalf("read backup: %v", err)
	}
	if !strings.Contains(string(backup), "DEEPSEEK_MODEL=old-model") {
		t.Fatalf("backup missing original model:\n%s", string(backup))
	}
}

func TestUpdateEnvFileAppendsMissingKeys(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".env.local")
	if err := os.WriteFile(path, []byte("AI_ACTIVE_PROVIDER=mock\n"), 0o600); err != nil {
		t.Fatalf("write env file: %v", err)
	}
	if err := config.UpdateEnvFile(path, map[string]string{"DEEPSEEK_API_KEY": "sk-appended"}); err != nil {
		t.Fatalf("update env file: %v", err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read env file: %v", err)
	}
	text := string(got)
	if !strings.Contains(text, "AI_ACTIVE_PROVIDER=mock") || !strings.HasSuffix(text, "\nDEEPSEEK_API_KEY=sk-appended\n") {
		t.Fatalf("appended content wrong:\n%s", text)
	}
}

func TestUpdateEnvFileRemovesEmptyValues(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".env.local")
	if err := os.WriteFile(path, []byte("DEEPSEEK_API_KEY=sk-to-clear\nDEEPSEEK_MODEL=flash\n"), 0o600); err != nil {
		t.Fatalf("write env file: %v", err)
	}
	if err := config.UpdateEnvFile(path, map[string]string{"DEEPSEEK_API_KEY": ""}); err != nil {
		t.Fatalf("update env file: %v", err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read env file: %v", err)
	}
	text := string(got)
	if strings.Contains(text, "DEEPSEEK_API_KEY") {
		t.Fatalf("cleared key still present:\n%s", text)
	}
	if !strings.Contains(text, "DEEPSEEK_MODEL=flash") {
		t.Fatalf("unrelated key removed:\n%s", text)
	}
}

func TestUpdateEnvFileRejectsUnknownKeys(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".env.local")
	if err := os.WriteFile(path, []byte(""), 0o600); err != nil {
		t.Fatalf("write env file: %v", err)
	}
	if err := config.UpdateEnvFile(path, map[string]string{"HACKED_KEY": "x"}); err == nil {
		t.Fatal("expected unknown key rejection")
	}
}
