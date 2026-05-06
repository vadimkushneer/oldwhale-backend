package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
)

const defaultOllamaBaseURL = "http://localhost:11434"

// ConversationMessage is one prior chat turn supplied by the editor UI.
type ConversationMessage struct {
	ID           string
	Role         string
	Text         string
	Model        string
	ModelVariant string
}

// ChatRequest is the provider-neutral request shape used by the API layer.
type ChatRequest struct {
	Provider            string
	Model               string
	APIKey              string
	Message             string
	EditorMode          string
	ConversationHistory []ConversationMessage
	WorkfieldHTML       string
}

// Client sends a chat request to an upstream LLM provider.
type Client interface {
	Chat(ctx context.Context, req ChatRequest) (string, error)
}

// OllamaClient calls the Ollama chat API.
type OllamaClient struct {
	BaseURL    string
	HTTPClient *http.Client
}

func NewOllamaClient(baseURL string) *OllamaClient {
	return &OllamaClient{BaseURL: strings.TrimSpace(baseURL)}
}

func (c *OllamaClient) Chat(ctx context.Context, req ChatRequest) (string, error) {
	model := strings.TrimSpace(req.Model)
	if model == "" {
		return "", fmt.Errorf("ollama model is required")
	}
	endpoint, err := ollamaChatURL(c.BaseURL)
	if err != nil {
		return "", err
	}
	body := ollamaChatRequest{
		Model:    model,
		Stream:   false,
		Messages: buildOllamaMessages(req),
	}
	if len(body.Messages) == 0 {
		return "", fmt.Errorf("message is required")
	}
	rawBody, err := json.Marshal(body)
	if err != nil {
		return "", err
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(rawBody))
	if err != nil {
		return "", err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	apiKey := strings.TrimSpace(req.APIKey)
	if apiKey != "" {
		httpReq.Header.Set("Authorization", "Bearer "+apiKey)
	}
	client := c.HTTPClient
	if client == nil {
		client = http.DefaultClient
	}
	res, err := client.Do(httpReq)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		var errBody struct {
			Error string `json:"error"`
		}
		_ = json.NewDecoder(res.Body).Decode(&errBody)
		msg := strings.TrimSpace(errBody.Error)
		if msg == "" {
			msg = res.Status
		}
		return "", fmt.Errorf("ollama chat failed: %s", msg)
	}
	var out ollamaChatResponse
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		return "", err
	}
	reply := strings.TrimSpace(out.Message.Content)
	if reply == "" {
		reply = strings.TrimSpace(out.Response)
	}
	if reply == "" {
		return "", fmt.Errorf("ollama returned an empty reply")
	}
	return reply, nil
}

type ollamaChatRequest struct {
	Model    string          `json:"model"`
	Stream   bool            `json:"stream"`
	Messages []ollamaMessage `json:"messages"`
}

type ollamaMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type ollamaChatResponse struct {
	Message  ollamaMessage `json:"message"`
	Response string        `json:"response"`
}

func ollamaChatURL(base string) (string, error) {
	base = strings.TrimSpace(base)
	if base == "" {
		base = defaultOllamaBaseURL
	}
	u, err := url.Parse(base)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return "", fmt.Errorf("invalid OLLAMA_BASE_URL")
	}
	u.Path = strings.TrimRight(u.Path, "/") + "/api/chat"
	u.RawQuery = ""
	u.Fragment = ""
	return u.String(), nil
}

func buildOllamaMessages(req ChatRequest) []ollamaMessage {
	var messages []ollamaMessage
	systemParts := []string{
		"You are Old Whale's writing assistant. Respond in the same language as the user unless they ask otherwise.",
	}
	if mode := strings.TrimSpace(req.EditorMode); mode != "" {
		systemParts = append(systemParts, "Editor mode: "+mode+".")
	}
	if html := strings.TrimSpace(req.WorkfieldHTML); html != "" {
		systemParts = append(systemParts, "Current workfield HTML:\n"+html)
	}
	messages = append(messages, ollamaMessage{Role: "system", Content: strings.Join(systemParts, "\n\n")})
	for _, msg := range req.ConversationHistory {
		content := strings.TrimSpace(msg.Text)
		if content == "" {
			continue
		}
		role := ollamaRole(msg.Role)
		messages = append(messages, ollamaMessage{Role: role, Content: content})
	}
	if content := strings.TrimSpace(req.Message); content != "" {
		messages = append(messages, ollamaMessage{Role: "user", Content: content})
	}
	return messages
}

func ollamaRole(role string) string {
	switch strings.TrimSpace(strings.ToLower(role)) {
	case "user":
		return "user"
	case "ai":
		return "assistant"
	case "sys":
		return "system"
	default:
		return "user"
	}
}
