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

const defaultAnthropicBaseURL = "https://api.anthropic.com"
const anthropicAPIVersion = "2023-06-01"
const defaultAnthropicMaxTokens = 2048

// AnthropicClient calls the Anthropic Messages API.
type AnthropicClient struct {
	BaseURL    string
	HTTPClient *http.Client
}

func NewAnthropicClient(baseURL string) *AnthropicClient {
	return &AnthropicClient{BaseURL: strings.TrimSpace(baseURL)}
}

func (c *AnthropicClient) Chat(ctx context.Context, req ChatRequest) (string, error) {
	model := strings.TrimSpace(req.Model)
	if model == "" {
		return "", fmt.Errorf("anthropic model is required")
	}
	apiKey := strings.TrimSpace(req.APIKey)
	if apiKey == "" {
		return "", fmt.Errorf("anthropic api key is required")
	}
	endpoint, err := anthropicMessagesURL(c.BaseURL)
	if err != nil {
		return "", err
	}
	body := buildAnthropicRequest(req)
	body.Model = model
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
	httpReq.Header.Set("x-api-key", apiKey)
	httpReq.Header.Set("anthropic-version", anthropicAPIVersion)
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
		var errBody anthropicErrorResponse
		_ = json.NewDecoder(res.Body).Decode(&errBody)
		msg := strings.TrimSpace(errBody.Error.Message)
		if msg == "" {
			msg = res.Status
		}
		return "", fmt.Errorf("anthropic chat failed: %s", msg)
	}
	var out anthropicResponse
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		return "", err
	}
	for _, item := range out.Content {
		if item.Type == "text" || item.Type == "" {
			if text := strings.TrimSpace(item.Text); text != "" {
				return text, nil
			}
		}
	}
	return "", fmt.Errorf("anthropic returned an empty reply")
}

type anthropicRequest struct {
	Model     string             `json:"model"`
	MaxTokens int                `json:"max_tokens"`
	System    string             `json:"system,omitempty"`
	Messages  []anthropicMessage `json:"messages"`
}

type anthropicMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type anthropicResponse struct {
	Content []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	} `json:"content"`
}

type anthropicErrorResponse struct {
	Error struct {
		Message string `json:"message"`
	} `json:"error"`
}

func anthropicMessagesURL(base string) (string, error) {
	base = strings.TrimSpace(base)
	if base == "" {
		base = defaultAnthropicBaseURL
	}
	u, err := url.Parse(base)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return "", fmt.Errorf("invalid ANTHROPIC_BASE_URL")
	}
	u.Path = strings.TrimRight(u.Path, "/") + "/v1/messages"
	u.RawQuery = ""
	u.Fragment = ""
	return u.String(), nil
}

func buildAnthropicRequest(req ChatRequest) anthropicRequest {
	systemParts := []string{
		"You are Old Whale's writing assistant. Respond in the same language as the user unless they ask otherwise.",
	}
	if mode := strings.TrimSpace(req.EditorMode); mode != "" {
		systemParts = append(systemParts, "Editor mode: "+mode+".")
	}
	if html := strings.TrimSpace(req.WorkfieldHTML); html != "" {
		systemParts = append(systemParts, "Current workfield HTML:\n"+html)
	}
	var messages []anthropicMessage
	for _, msg := range req.ConversationHistory {
		content := strings.TrimSpace(msg.Text)
		if content == "" {
			continue
		}
		switch anthropicRole(msg.Role) {
		case "system":
			systemParts = append(systemParts, content)
		case "assistant":
			messages = append(messages, anthropicMessage{Role: "assistant", Content: content})
		default:
			messages = append(messages, anthropicMessage{Role: "user", Content: content})
		}
	}
	if content := strings.TrimSpace(req.Message); content != "" {
		messages = append(messages, anthropicMessage{Role: "user", Content: content})
	}
	return anthropicRequest{
		MaxTokens: defaultAnthropicMaxTokens,
		System:    strings.Join(systemParts, "\n\n"),
		Messages:  messages,
	}
}

func anthropicRole(role string) string {
	switch strings.TrimSpace(strings.ToLower(role)) {
	case "ai":
		return "assistant"
	case "sys":
		return "system"
	default:
		return "user"
	}
}
