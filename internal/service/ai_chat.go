package service

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/netip"
	"strings"

	"github.com/google/uuid"

	dbgen "github.com/oldwhale/backend/internal/db/generated"
	"github.com/oldwhale/backend/internal/domain"
	"github.com/oldwhale/backend/internal/jobs"
	"github.com/oldwhale/backend/internal/llm"
)

const maxNoteContextBytes = 512 * 1024

type AIChatService struct {
	q       dbgen.Querier
	secrets *SecretsService
	jobs    *jobs.AIChatJobStore
	llm     llm.Client
	chatLog *AIChatLogService
}

func NewAIChatService(q dbgen.Querier, secrets *SecretsService, store *jobs.AIChatJobStore, client llm.Client, chatLog *AIChatLogService) *AIChatService {
	return &AIChatService{q: q, secrets: secrets, jobs: store, llm: client, chatLog: chatLog}
}

type StartJobInput struct {
	UserUID     *uuid.UUID
	GroupUID    uuid.UUID
	VariantUID  uuid.UUID
	Message     string
	EditorMode  domain.EditorMode
	NoteContext json.RawMessage
	ClientIP    *netip.Addr
	UserAgent   *string
}

type StartJobOutput struct {
	RequestUID          uuid.UUID
	UserMessageUID      uuid.UUID
	AssistantMessageUID uuid.UUID
}

func (s *AIChatService) StartJob(ctx context.Context, in StartJobInput) (StartJobOutput, error) {
	message := strings.TrimSpace(in.Message)
	if message == "" {
		return StartJobOutput{}, domain.ErrInvalidInput
	}
	mode := in.EditorMode
	if mode == "" {
		mode = domain.EditorModeFilm
	}
	if !mode.IsValid() {
		return StartJobOutput{}, domain.ErrInvalidInput
	}
	group, err := s.q.GetAIGroupByUID(ctx, in.GroupUID)
	if err != nil {
		return StartJobOutput{}, mapNoRows(err)
	}
	variant, err := s.q.GetAIVariantByUID(ctx, in.VariantUID)
	if err != nil {
		return StartJobOutput{}, mapNoRows(err)
	}
	if variant.GroupUid != group.Uid {
		return StartJobOutput{}, domain.ErrInvalidInput
	}
	modelID, err := domain.ValidateProviderModelID(variant.ProviderModelID)
	if err != nil {
		return StartJobOutput{}, domain.ErrInvalidInput
	}
	if !llm.SupportsProvider(group.Slug) {
		return StartJobOutput{}, domain.ErrInvalidInput
	}
	apiKey, ok := s.secrets.Resolve(group.ApiKeyEnvVar)
	if !ok {
		return StartJobOutput{}, domain.ErrAPIKeyNotConfigured
	}
	var note domain.AIChatNoteContext
	if mode == domain.EditorModeNote {
		if len(in.NoteContext) == 0 || len(in.NoteContext) > maxNoteContextBytes {
			return StartJobOutput{}, domain.ErrInvalidInput
		}
		if err := json.Unmarshal(in.NoteContext, &note); err != nil {
			return StartJobOutput{}, domain.ErrInvalidInput
		}
		for _, msg := range note.ConversationHistory {
			if strings.TrimSpace(msg.ID) == "" || !msg.Role.IsValid() {
				return StartJobOutput{}, domain.ErrInvalidInput
			}
		}
	}
	out := StartJobOutput{
		RequestUID:          domain.NewUID(),
		UserMessageUID:      domain.NewUID(),
		AssistantMessageUID: domain.NewUID(),
	}
	s.jobs.Create(out.RequestUID.String(), out.UserMessageUID.String(), out.AssistantMessageUID.String())
	req := llm.ChatRequest{
		Provider:            group.Slug,
		Model:               modelID,
		APIKey:              apiKey,
		Message:             message,
		EditorMode:          string(mode),
		ConversationHistory: llmHistory(note.ConversationHistory),
		WorkfieldHTML:       note.WorkfieldHTML,
	}
	logPayload := domain.AIChatLog{
		UID:                 domain.NewUID(),
		UserUID:             in.UserUID,
		GroupUID:            &in.GroupUID,
		VariantUID:          &in.VariantUID,
		Message:             message,
		UserMessageUID:      out.UserMessageUID,
		AssistantMessageUID: out.AssistantMessageUID,
		ClientIP:            in.ClientIP,
		UserAgent:           in.UserAgent,
		EditorMode:          mode,
		NoteContext:         in.NoteContext,
	}
	go s.runJob(out.RequestUID.String(), req, logPayload)
	return out, nil
}

func (s *AIChatService) runJob(requestUID string, req llm.ChatRequest, logPayload domain.AIChatLog) {
	reply, err := s.llm.Chat(context.Background(), req)
	if err != nil {
		slog.Warn("ai chat llm request failed", "request_uid", requestUID, "err", err)
		s.jobs.CompleteError(requestUID, "Не удалось получить ответ от LLM.")
		return
	}
	logPayload.Reply = reply
	if s.chatLog != nil {
		if _, err := s.chatLog.Insert(context.Background(), logPayload); err != nil {
			slog.Warn("ai chat log insert failed", "err", err)
		}
	}
	s.jobs.CompleteReady(requestUID, reply)
}

func llmHistory(history []domain.AIChatConversationMessage) []llm.ConversationMessage {
	out := make([]llm.ConversationMessage, 0, len(history))
	for _, msg := range history {
		out = append(out, llm.ConversationMessage{
			ID:           msg.ID,
			Role:         string(msg.Role),
			Text:         msg.Text,
			Model:        msg.Model,
			ModelVariant: msg.ModelVariant,
		})
	}
	return out
}

func (s *AIChatService) Jobs() *jobs.AIChatJobStore {
	return s.jobs
}
