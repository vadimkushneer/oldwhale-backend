package llm

import (
	"context"
	"fmt"
	"net/http"
	"strings"
)

// ProviderClient dispatches chat requests to the selected provider.
type ProviderClient struct {
	Ollama    *OllamaClient
	Anthropic *AnthropicClient
}

func NewProviderClient(anthropicBaseURL, ollamaBaseURL string) *ProviderClient {
	return &ProviderClient{
		Ollama:    NewOllamaClient(ollamaBaseURL),
		Anthropic: NewAnthropicClient(anthropicBaseURL),
	}
}

func (c *ProviderClient) Chat(ctx context.Context, req ChatRequest) (string, error) {
	switch NormalizeProvider(req.Provider) {
	case "ollama":
		client := c.Ollama
		if client == nil {
			client = NewOllamaClient("")
		}
		return client.Chat(ctx, req)
	case "anthropic":
		client := c.Anthropic
		if client == nil {
			client = NewAnthropicClient("")
		}
		return client.Chat(ctx, req)
	default:
		return "", fmt.Errorf("unsupported ai provider: %s", req.Provider)
	}
}

func (c *ProviderClient) SetHTTPClient(client *http.Client) {
	if c.Ollama != nil {
		c.Ollama.HTTPClient = client
	}
	if c.Anthropic != nil {
		c.Anthropic.HTTPClient = client
	}
}

func NormalizeProvider(provider string) string {
	s := strings.TrimSpace(strings.ToLower(provider))
	switch s {
	case "claude":
		return "anthropic"
	default:
		// Catalog groups often use distinct slugs (e.g. `ollama-local`) while still using the Ollama HTTP API.
		if strings.HasPrefix(s, "ollama") {
			return "ollama"
		}
		return s
	}
}

func SupportsProvider(provider string) bool {
	switch NormalizeProvider(provider) {
	case "ollama", "anthropic":
		return true
	default:
		return false
	}
}
