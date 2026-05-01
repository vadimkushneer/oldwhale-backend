package llm

import (
	"os"
	"strings"
)

func resolveSecret(raw, fallback string) string {
	value := strings.TrimSpace(raw)
	if value != "" {
		if envValue, ok := os.LookupEnv(value); ok && strings.TrimSpace(envValue) != "" {
			return strings.TrimSpace(envValue)
		}
		return value
	}
	return strings.TrimSpace(fallback)
}
