package api

import (
	"sync"
	"time"

	"github.com/oldwhale/backend/internal/llm"
)

const aiChatJobTTL = 30 * time.Minute

type aiChatJob struct {
	RequestID          string
	UserMessageID      string
	AssistantMessageID string
	CreatedAt          time.Time

	done        chan struct{}
	completedAt time.Time
	reply       string
	err         string
	closed      bool
}

// AIChatJobStore keeps pending chat requests for the current API process.
type AIChatJobStore struct {
	mu   sync.Mutex
	jobs map[string]*aiChatJob
}

func NewAIChatJobStore() *AIChatJobStore {
	return &AIChatJobStore{jobs: make(map[string]*aiChatJob)}
}

func (s *Server) aiChatClient() llm.Client {
	if s.AIChatClient != nil {
		return s.AIChatClient
	}
	s.aiChatInitMu.Lock()
	defer s.aiChatInitMu.Unlock()
	if s.AIChatClient == nil {
		s.AIChatClient = llm.NewProviderClientFromEnv()
	}
	return s.AIChatClient
}

func (s *Server) aiChatJobStore() *AIChatJobStore {
	if s.AIChatJobs != nil {
		return s.AIChatJobs
	}
	s.aiChatInitMu.Lock()
	defer s.aiChatInitMu.Unlock()
	if s.AIChatJobs == nil {
		s.AIChatJobs = NewAIChatJobStore()
	}
	return s.AIChatJobs
}

func (s *AIChatJobStore) Create(requestID, userMessageID, assistantMessageID string) *aiChatJob {
	now := time.Now().UTC()
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cleanupLocked(now)
	job := &aiChatJob{
		RequestID:          requestID,
		UserMessageID:      userMessageID,
		AssistantMessageID: assistantMessageID,
		CreatedAt:          now,
		done:               make(chan struct{}),
	}
	s.jobs[requestID] = job
	return job
}

func (s *AIChatJobStore) Get(requestID string) (*aiChatJob, bool) {
	now := time.Now().UTC()
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cleanupLocked(now)
	job, ok := s.jobs[requestID]
	return job, ok
}

func (s *AIChatJobStore) CompleteReady(requestID, reply string) {
	s.complete(requestID, reply, "")
}

func (s *AIChatJobStore) CompleteError(requestID, msg string) {
	s.complete(requestID, "", msg)
}

func (s *AIChatJobStore) complete(requestID, reply, errMsg string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	job, ok := s.jobs[requestID]
	if !ok || job.closed {
		return
	}
	job.reply = reply
	job.err = errMsg
	job.completedAt = time.Now().UTC()
	job.closed = true
	close(job.done)
}

func (s *AIChatJobStore) cleanupLocked(now time.Time) {
	for id, job := range s.jobs {
		if !job.completedAt.IsZero() && now.Sub(job.completedAt) > aiChatJobTTL {
			delete(s.jobs, id)
		}
	}
}
