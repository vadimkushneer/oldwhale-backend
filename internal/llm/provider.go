package llm

import (
	"context"
	"fmt"
	"net/http"
	"strings"
)

// ProviderClient dispatches chat requests to the provider selected by groupSlug.
type ProviderClient struct {
	Ollama    *OllamaClient
	Anthropic *AnthropicClient
}

// NewProviderClientFromEnv creates provider clients using environment defaults.
func NewProviderClientFromEnv() *ProviderClient {
	return &ProviderClient{
		Ollama:    NewOllamaClientFromEnv(),
		Anthropic: NewAnthropicClientFromEnv(),
	}
}

func (c *ProviderClient) Chat(ctx context.Context, req ChatRequest) (string, error) {
	switch NormalizeProvider(req.Provider) {
	case "ollama":
		client := c.Ollama
		if client == nil {
			client = NewOllamaClientFromEnv()
		}
		return client.Chat(ctx, req)
	case "anthropic":
		client := c.Anthropic
		if client == nil {
			client = NewAnthropicClientFromEnv()
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
	switch strings.TrimSpace(strings.ToLower(provider)) {
	case "claude":
		return "anthropic"
	default:
		return strings.TrimSpace(strings.ToLower(provider))
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
