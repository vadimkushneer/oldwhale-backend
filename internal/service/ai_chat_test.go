package service

import (
	"context"
	"testing"

	"github.com/oldwhale/backend/internal/domain"
	"github.com/oldwhale/backend/internal/jobs"
	"github.com/oldwhale/backend/internal/llm"
)

type fakeAIChatClient struct {
	reply string
	err   error
	seen  chan llm.ChatRequest
}

func (f fakeAIChatClient) Chat(ctx context.Context, req llm.ChatRequest) (string, error) {
	if f.seen != nil {
		f.seen <- req
	}
	return f.reply, f.err
}

func TestAIChatJobCompletesReadyResult(t *testing.T) {
	seen := make(chan llm.ChatRequest, 1)
	store := jobs.NewAIChatJobStore()
	svc := NewAIChatService(nil, NewSecretsService(), store, fakeAIChatClient{reply: "real reply", seen: seen}, nil)
	store.Create("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "cccccccc-cccc-4ccc-8ccc-cccccccccccc")
	go svc.runJob("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", llm.ChatRequest{Provider: "ollama", Model: "llama3.2", Message: "hello"}, domain.AIChatLog{})
	job, ok := store.Get("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
	if !ok {
		t.Fatal("job not found")
	}
	<-job.Done()
	if job.Reply() != "real reply" || job.Error() != "" {
		t.Fatalf("unexpected job state reply=%q err=%q", job.Reply(), job.Error())
	}
	gotReq := <-seen
	if gotReq.Model != "llama3.2" {
		t.Fatalf("model = %q", gotReq.Model)
	}
}
