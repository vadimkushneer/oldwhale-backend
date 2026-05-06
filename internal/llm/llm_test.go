package llm

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestOllamaClientChatUsesModelMessagesAndAuth(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/chat" {
			t.Fatalf("path = %q", r.URL.Path)
		}
		if r.Method != http.MethodPost {
			t.Fatalf("method = %q", r.Method)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer group-key" {
			t.Fatalf("Authorization = %q", got)
		}
		var in ollamaChatRequest
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			t.Fatal(err)
		}
		if in.Model != "llama3.2" {
			t.Fatalf("model = %q", in.Model)
		}
		if in.Stream {
			t.Fatal("expected stream=false")
		}
		if len(in.Messages) != 4 {
			t.Fatalf("expected 4 messages, got %#v", in.Messages)
		}
		if in.Messages[0].Role != "system" || in.Messages[1].Role != "system" || in.Messages[2].Role != "assistant" || in.Messages[3].Role != "user" {
			t.Fatalf("unexpected roles: %#v", in.Messages)
		}
		if in.Messages[3].Content != "Write a poem" {
			t.Fatalf("user content = %q", in.Messages[3].Content)
		}
		_, _ = w.Write([]byte(`{"message":{"role":"assistant","content":" Done "}}`))
	}))
	defer ts.Close()

	client := &OllamaClient{BaseURL: ts.URL, HTTPClient: ts.Client()}
	reply, err := client.Chat(context.Background(), ChatRequest{
		Model:         "llama3.2",
		APIKey:        "group-key",
		Message:       "Write a poem",
		EditorMode:    "note",
		WorkfieldHTML: "<p>Draft</p>",
		ConversationHistory: []ConversationMessage{
			{Role: "sys", Text: "Be concise"},
			{Role: "ai", Text: "Sure"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if reply != "Done" {
		t.Fatalf("reply = %q", reply)
	}
}

func TestAnthropicClientChatUsesModelMessagesAndAuth(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/messages" {
			t.Fatalf("path = %q", r.URL.Path)
		}
		if r.Method != http.MethodPost {
			t.Fatalf("method = %q", r.Method)
		}
		if got := r.Header.Get("x-api-key"); got != "resolved-group-key" {
			t.Fatalf("x-api-key = %q", got)
		}
		if got := r.Header.Get("anthropic-version"); got != anthropicAPIVersion {
			t.Fatalf("anthropic-version = %q", got)
		}
		var in anthropicRequest
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			t.Fatal(err)
		}
		if in.Model != "claude-3-5-sonnet-latest" {
			t.Fatalf("model = %q", in.Model)
		}
		if in.MaxTokens != defaultAnthropicMaxTokens {
			t.Fatalf("max_tokens = %d", in.MaxTokens)
		}
		if !strings.Contains(in.System, "Current workfield HTML") || !strings.Contains(in.System, "Be concise") {
			t.Fatalf("system prompt = %q", in.System)
		}
		if len(in.Messages) != 2 {
			t.Fatalf("expected 2 messages, got %#v", in.Messages)
		}
		if in.Messages[0].Role != "assistant" || in.Messages[1].Role != "user" {
			t.Fatalf("unexpected messages: %#v", in.Messages)
		}
		_, _ = w.Write([]byte(`{"content":[{"type":"text","text":" Anthropic done "}]}`))
	}))
	defer ts.Close()

	client := &AnthropicClient{BaseURL: ts.URL, HTTPClient: ts.Client()}
	reply, err := client.Chat(context.Background(), ChatRequest{
		Model:         "claude-3-5-sonnet-latest",
		APIKey:        "resolved-group-key",
		Message:       "Write a poem",
		EditorMode:    "note",
		WorkfieldHTML: "<p>Draft</p>",
		ConversationHistory: []ConversationMessage{
			{Role: "sys", Text: "Be concise"},
			{Role: "ai", Text: "Sure"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if reply != "Anthropic done" {
		t.Fatalf("reply = %q", reply)
	}
}

func TestProviderClientDispatchesAnthropicAliases(t *testing.T) {
	if !SupportsProvider("anthropic") || !SupportsProvider("claude") {
		t.Fatal("expected anthropic and claude providers to be supported")
	}
	if NormalizeProvider("claude") != "anthropic" {
		t.Fatalf("claude alias normalized to %q", NormalizeProvider("claude"))
	}
}

func TestSupportsProviderOllamaSlugPrefixes(t *testing.T) {
	for _, slug := range []string{"ollama", "ollama-local", "Ollama-Dev"} {
		if !SupportsProvider(slug) {
			t.Fatalf("SupportsProvider(%q) = false", slug)
		}
		if got := NormalizeProvider(slug); got != "ollama" {
			t.Fatalf("NormalizeProvider(%q) = %q, want ollama", slug, got)
		}
	}
	if SupportsProvider("not-ollama-really") {
		t.Fatal("expected arbitrary slug with substring ollama to stay unsupported unless ollama-prefixed")
	}
}
