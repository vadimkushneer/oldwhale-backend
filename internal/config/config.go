package config

import (
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	DatabaseURL        string
	JWTSecret          []byte
	JWTTTL             time.Duration
	HTTPAddr           string
	CORSOrigin         string
	AdminUsername      string
	AdminPassword      string
	AdminEmail         string
	AnthropicAPIKey    string
	AnthropicBaseURL   string
	OllamaBaseURL      string
	OllamaAPIKey       string
	ResetSchemaOnStart bool
	// AdminPasswordSync, when true, overwrites the stored hash for the admin user
	// if it does not match AdminPassword (local/dev; keep false in production).
	AdminPasswordSync bool
}

func MustLoad() Config {
	cfg, err := Load()
	if err != nil {
		log.Fatal(err)
	}
	return cfg
}

func Load() (Config, error) {
	cfg := Config{
		DatabaseURL:      cleanEnv("DATABASE_URL"),
		JWTSecret:        []byte(cleanEnv("JWT_SECRET")),
		JWTTTL:           72 * time.Hour,
		CORSOrigin:       cleanEnv("CORS_ORIGIN"),
		AdminUsername:    cleanEnv("ADMIN_USERNAME"),
		AdminPassword:    cleanEnv("ADMIN_PASSWORD"),
		AdminEmail:       cleanEnv("ADMIN_EMAIL"),
		AnthropicAPIKey:  cleanEnv("ANTHROPIC_API_KEY"),
		AnthropicBaseURL: cleanEnv("ANTHROPIC_BASE_URL"),
		OllamaBaseURL:    cleanEnv("OLLAMA_BASE_URL"),
		OllamaAPIKey:     cleanEnv("OLLAMA_API_KEY"),
	}
	if cfg.DatabaseURL == "" {
		return Config{}, fmt.Errorf("DATABASE_URL is required")
	}
	if strings.Contains(cfg.DatabaseURL, "${") {
		return Config{}, fmt.Errorf("DATABASE_URL still contains ${...}: bindable was not resolved")
	}
	if len(cfg.JWTSecret) < 16 {
		return Config{}, fmt.Errorf("JWT_SECRET is required and must be at least 16 bytes")
	}
	if ttlRaw := cleanEnv("JWT_TTL"); ttlRaw != "" {
		ttl, err := time.ParseDuration(ttlRaw)
		if err != nil {
			return Config{}, fmt.Errorf("JWT_TTL: %w", err)
		}
		cfg.JWTTTL = ttl
	}
	cfg.HTTPAddr = cleanEnv("HTTP_ADDR")
	if cfg.HTTPAddr == "" {
		if p := cleanEnv("PORT"); p != "" {
			cfg.HTTPAddr = ":" + p
		} else {
			cfg.HTTPAddr = ":8080"
		}
	}
	if cfg.AdminUsername == "" {
		return Config{}, fmt.Errorf("ADMIN_USERNAME is required")
	}
	if cfg.AdminPassword == "" {
		return Config{}, fmt.Errorf("ADMIN_PASSWORD is required")
	}
	if cfg.AdminEmail == "" {
		cfg.AdminEmail = "admin@oldwhale.local"
	}
	cfg.ResetSchemaOnStart = boolEnv("RESET_SCHEMA_ON_START")
	cfg.AdminPasswordSync = boolEnv("ADMIN_PASSWORD_SYNC")
	return cfg, nil
}

func cleanEnv(name string) string {
	v := strings.TrimSpace(os.Getenv(name))
	v = strings.Trim(v, `"'`)
	return strings.TrimSpace(v)
}

func boolEnv(name string) bool {
	v := strings.ToLower(cleanEnv(name))
	if v == "" {
		return false
	}
	if parsed, err := strconv.ParseBool(v); err == nil {
		return parsed
	}
	switch v {
	case "1", "yes", "y", "on":
		return true
	default:
		return false
	}
}
