package config

import (
	"bufio"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

type Config struct {
	ListenAddress   string
	DataDir         string
	DBPath          string
	ActiveProvider  string
	EnvFilePath     string
	DeepSeek        DeepSeekConfig
	DashScopeAPIKey string
	DashScopeVoice  string
	SeedFixtures    bool
}

// DeepSeekConfig holds the DeepSeek vendor settings. Secrets stay in memory
// only and are never persisted, returned by APIs, or logged.
type DeepSeekConfig struct {
	APIKey         string
	BaseURL        string
	Model          string
	ReasoningModel string
}

// VendorStatus is the read-only vendor view exposed to settings UI. Key values
// are never included; only whether a key is configured.
type VendorStatus struct {
	ID            string   `json:"id"`
	DisplayName   string   `json:"display_name"`
	Implemented   bool     `json:"implemented"`
	KeyConfigured bool     `json:"key_configured"`
	BaseURL       string   `json:"base_url,omitempty"`
	Models        []string `json:"models,omitempty"`
	Active        bool     `json:"active"`
}

func Load() (Config, error) {
	path := os.Getenv("STUDY_OS_ENV_FILE")
	if path == "" {
		path = ".env.local"
	}
	if _, err := os.Stat(path); err != nil {
		if !os.IsNotExist(err) {
			return Config{}, fmt.Errorf("stat env file %q: %w", path, err)
		}
		cfg, err := FromLookup(os.LookupEnv)
		if err != nil {
			return Config{}, err
		}
		cfg.EnvFilePath = path
		return cfg, nil
	}
	return LoadFromFile(path, os.LookupEnv)
}

func FromLookup(lookup func(string) (string, bool)) (Config, error) {
	return fromLookup(lookup)
}

// LoadFromFile loads optional local settings while giving process environment
// variables precedence. Secrets stay in memory and are never persisted.
func LoadFromFile(path string, lookup func(string) (string, bool)) (Config, error) {
	fileValues, err := parseEnvFile(path)
	if err != nil {
		return Config{}, err
	}
	merged := func(key string) (string, bool) {
		if value, ok := lookup(key); ok {
			return value, true
		}
		value, ok := fileValues[key]
		return value, ok
	}
	cfg, err := fromLookup(merged)
	if err != nil {
		return Config{}, err
	}
	cfg.EnvFilePath = path
	return cfg, nil
}

func fromLookup(lookup func(string) (string, bool)) (Config, error) {
	cfg := Config{
		ListenAddress:   valueOr(lookup, "STUDY_OS_LISTEN_ADDRESS", "127.0.0.1:8080"),
		DataDir:         valueOr(lookup, "STUDY_OS_DATA_DIR", "data"),
		ActiveProvider:  valueOr(lookup, "AI_ACTIVE_PROVIDER", "mock"),
		DashScopeAPIKey: envValue(lookup, "DASHSCOPE_API_KEY"),
		DashScopeVoice:  valueOr(lookup, "DASHSCOPE_TTS_VOICE", "longxiaochun"),
		DeepSeek: DeepSeekConfig{
			APIKey:         strings.TrimSpace(envValue(lookup, "DEEPSEEK_API_KEY")),
			BaseURL:        valueOr(lookup, "DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1"),
			Model:          valueOr(lookup, "DEEPSEEK_MODEL", "deepseek-v4-flash"),
			ReasoningModel: valueOr(lookup, "DEEPSEEK_REASONING_MODEL", "deepseek-v4-pro"),
		},
	}
	cfg.DBPath = valueOr(lookup, "STUDY_OS_DB_PATH", filepath.Join(cfg.DataDir, "study.db"))

	if value, ok := lookup("STUDY_OS_SEED_FIXTURES"); ok && strings.TrimSpace(value) != "" {
		seedFixtures, err := strconv.ParseBool(strings.TrimSpace(value))
		if err != nil {
			return Config{}, fmt.Errorf("parse STUDY_OS_SEED_FIXTURES: %w", err)
		}
		cfg.SeedFixtures = seedFixtures
	}

	if err := validateLoopbackAddress(cfg.ListenAddress); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

// Vendors returns the vendor registry view: the built-in offline mock, the
// implemented DeepSeek vendor, and reserved placeholders for future vendors.
func (c Config) Vendors() []VendorStatus {
	active := strings.ToLower(strings.TrimSpace(c.ActiveProvider))
	if active == "" {
		active = "mock"
	}
	model := strings.TrimSpace(c.DeepSeek.Model)
	if model == "" {
		model = "deepseek-v4-flash"
	}
	reasoningModel := strings.TrimSpace(c.DeepSeek.ReasoningModel)
	if reasoningModel == "" {
		reasoningModel = "deepseek-v4-pro"
	}
	return []VendorStatus{
		{
			ID:          "mock",
			DisplayName: "本地离线",
			Implemented: true,
			Active:      active == "mock",
		},
		{
			ID:            "deepseek",
			DisplayName:   "DeepSeek",
			Implemented:   true,
			KeyConfigured: strings.TrimSpace(c.DeepSeek.APIKey) != "",
			BaseURL:       strings.TrimRight(c.DeepSeek.BaseURL, "/"),
			Models: []string{
				model,
				reasoningModel,
			},
			Active: active == "deepseek",
		},
		{ID: "qwen", DisplayName: "通义千问（百炼）"},
		{ID: "glm", DisplayName: "智谱 GLM"},
		{ID: "openai", DisplayName: "OpenAI"},
		{ID: "volcengine", DisplayName: "火山豆包"},
	}
}

func envValue(lookup func(string) (string, bool), key string) string {
	value, ok := lookup(key)
	if !ok {
		return ""
	}
	return strings.TrimSpace(value)
}

func parseEnvFile(path string) (map[string]string, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open env file %q: %w", path, err)
	}
	defer file.Close()

	values := make(map[string]string)
	scanner := bufio.NewScanner(file)
	lineNumber := 0
	for scanner.Scan() {
		lineNumber++
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if strings.HasPrefix(line, "export ") {
			line = strings.TrimSpace(strings.TrimPrefix(line, "export "))
		}
		key, value, found := strings.Cut(line, "=")
		key = strings.TrimSpace(key)
		if !found || key == "" || strings.ContainsAny(key, " \t") {
			return nil, fmt.Errorf("parse env file %q line %d: expected KEY=value", path, lineNumber)
		}
		value = strings.TrimSpace(value)
		if len(value) >= 2 {
			first, last := value[0], value[len(value)-1]
			if (first == '"' && last == '"') || (first == '\'' && last == '\'') {
				value = value[1 : len(value)-1]
			}
		}
		values[key] = value
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("read env file %q: %w", path, err)
	}
	return values, nil
}

func valueOr(lookup func(string) (string, bool), key, fallback string) string {
	if value, ok := lookup(key); ok && strings.TrimSpace(value) != "" {
		return strings.TrimSpace(value)
	}
	return fallback
}

func validateLoopbackAddress(address string) error {
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return fmt.Errorf("parse listen address %q: %w", address, err)
	}
	if strings.EqualFold(host, "localhost") {
		return nil
	}
	ip := net.ParseIP(host)
	if ip == nil || !ip.IsLoopback() {
		return fmt.Errorf("listen address %q must use a loopback host", address)
	}
	return nil
}
