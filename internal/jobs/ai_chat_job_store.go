package jobs

import (
	"sync"
	"time"
)

const aiChatJobTTL = 30 * time.Minute

type AIChatJob struct {
	RequestUID          string
	UserMessageUID      string
	AssistantMessageUID string
	CreatedAt           time.Time

	done        chan struct{}
	completedAt time.Time
	reply       string
	err         string
	closed      bool
}

type AIChatJobStore struct {
	mu   sync.Mutex
	jobs map[string]*AIChatJob
}

func NewAIChatJobStore() *AIChatJobStore {
	return &AIChatJobStore{jobs: make(map[string]*AIChatJob)}
}

func (s *AIChatJobStore) Create(requestUID, userMessageUID, assistantMessageUID string) *AIChatJob {
	now := time.Now().UTC()
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cleanupLocked(now)
	job := &AIChatJob{
		RequestUID:          requestUID,
		UserMessageUID:      userMessageUID,
		AssistantMessageUID: assistantMessageUID,
		CreatedAt:           now,
		done:                make(chan struct{}),
	}
	s.jobs[requestUID] = job
	return job
}

func (s *AIChatJobStore) Get(requestUID string) (*AIChatJob, bool) {
	now := time.Now().UTC()
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cleanupLocked(now)
	job, ok := s.jobs[requestUID]
	return job, ok
}

func (s *AIChatJobStore) CompleteReady(requestUID, reply string) {
	s.complete(requestUID, reply, "")
}

func (s *AIChatJobStore) CompleteError(requestUID, msg string) {
	s.complete(requestUID, "", msg)
}

func (s *AIChatJobStore) complete(requestUID, reply, errMsg string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	job, ok := s.jobs[requestUID]
	if !ok || job.closed {
		return
	}
	job.reply = reply
	job.err = errMsg
	job.completedAt = time.Now().UTC()
	job.closed = true
	close(job.done)
}

func (j *AIChatJob) Done() <-chan struct{} {
	return j.done
}

func (j *AIChatJob) Reply() string {
	return j.reply
}

func (j *AIChatJob) Error() string {
	return j.err
}

func (s *AIChatJobStore) cleanupLocked(now time.Time) {
	for uid, job := range s.jobs {
		if !job.completedAt.IsZero() && now.Sub(job.completedAt) > aiChatJobTTL {
			delete(s.jobs, uid)
		}
	}
}
