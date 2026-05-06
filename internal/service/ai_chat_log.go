package service

import (
	"context"
	"encoding/json"
	"fmt"
	"net/netip"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	dbgen "github.com/oldwhale/backend/internal/db/generated"
	"github.com/oldwhale/backend/internal/domain"
)

type AIChatLogService struct {
	q    dbgen.Querier
	pool *pgxpool.Pool
}

func NewAIChatLogService(q dbgen.Querier, pool *pgxpool.Pool) *AIChatLogService {
	return &AIChatLogService{q: q, pool: pool}
}

type AIChatLogFilters struct {
	UID                 *uuid.UUID
	From                *time.Time
	To                  *time.Time
	UserUID             *uuid.UUID
	GroupUID            *uuid.UUID
	VariantUID          *uuid.UUID
	MessageContains     *string
	ReplyContains       *string
	UserMessageUID      *uuid.UUID
	AssistantMessageUID *uuid.UUID
	ClientIPContains    *string
	UserAgentContains   *string
	UsernameContains    *string
	EmailContains       *string
	EditorModeExact     *domain.EditorMode
}

func (s *AIChatLogService) Insert(ctx context.Context, log domain.AIChatLog) (domain.AIChatLog, error) {
	note := []byte(log.NoteContext)
	if len(note) == 0 || !json.Valid(note) {
		note = nil
	}
	row, err := s.q.InsertAIChatLog(ctx, dbgen.InsertAIChatLogParams{
		Uid:                 log.UID,
		UserUid:             uuidPtrToPg(log.UserUID),
		GroupUid:            uuidPtrToPg(log.GroupUID),
		VariantUid:          uuidPtrToPg(log.VariantUID),
		Message:             log.Message,
		Reply:               log.Reply,
		UserMessageUid:      log.UserMessageUID,
		AssistantMessageUid: log.AssistantMessageUID,
		ClientIp:            log.ClientIP,
		UserAgent:           log.UserAgent,
		EditorMode:          string(log.EditorMode),
		NoteContext:         note,
	})
	if err != nil {
		return domain.AIChatLog{}, err
	}
	return dbChatLogToDomain(row), nil
}

func dbChatLogToDomain(row dbgen.AiChatLog) domain.AIChatLog {
	return domain.AIChatLog{
		UID:                 row.Uid,
		CreatedAt:           row.CreatedAt,
		UserUID:             pgUUIDPtr(row.UserUid),
		GroupUID:            pgUUIDPtr(row.GroupUid),
		VariantUID:          pgUUIDPtr(row.VariantUid),
		Message:             row.Message,
		Reply:               row.Reply,
		UserMessageUID:      row.UserMessageUid,
		AssistantMessageUID: row.AssistantMessageUid,
		ClientIP:            row.ClientIp,
		UserAgent:           row.UserAgent,
		EditorMode:          domain.EditorMode(row.EditorMode),
		NoteContext:         row.NoteContext,
	}
}

func (s *AIChatLogService) ListAdmin(ctx context.Context, f AIChatLogFilters, page Page) ([]domain.AIChatLogItem, int, error) {
	if page.Limit <= 0 {
		page.Limit = 50
	}
	if page.Limit > 200 {
		page.Limit = 200
	}
	if page.Offset < 0 {
		page.Offset = 0
	}
	where := []string{"1=1"}
	args := []any{}
	add := func(cond string, v any) {
		args = append(args, v)
		where = append(where, fmt.Sprintf(cond, len(args)))
	}
	if f.UID != nil {
		add("l.uid = $%d", *f.UID)
	}
	if f.From != nil {
		add("l.created_at >= $%d", *f.From)
	}
	if f.To != nil {
		add("l.created_at <= $%d", *f.To)
	}
	if f.UserUID != nil {
		add("l.user_uid = $%d", *f.UserUID)
	}
	if f.GroupUID != nil {
		add("l.group_uid = $%d", *f.GroupUID)
	}
	if f.VariantUID != nil {
		add("l.variant_uid = $%d", *f.VariantUID)
	}
	if f.MessageContains != nil && strings.TrimSpace(*f.MessageContains) != "" {
		add("l.message ILIKE $%d", "%"+strings.TrimSpace(*f.MessageContains)+"%")
	}
	if f.ReplyContains != nil && strings.TrimSpace(*f.ReplyContains) != "" {
		add("l.reply ILIKE $%d", "%"+strings.TrimSpace(*f.ReplyContains)+"%")
	}
	if f.UserMessageUID != nil {
		add("l.user_message_uid = $%d", *f.UserMessageUID)
	}
	if f.AssistantMessageUID != nil {
		add("l.assistant_message_uid = $%d", *f.AssistantMessageUID)
	}
	if f.ClientIPContains != nil && strings.TrimSpace(*f.ClientIPContains) != "" {
		add("l.client_ip::text ILIKE $%d", "%"+strings.TrimSpace(*f.ClientIPContains)+"%")
	}
	if f.UserAgentContains != nil && strings.TrimSpace(*f.UserAgentContains) != "" {
		add("l.user_agent ILIKE $%d", "%"+strings.TrimSpace(*f.UserAgentContains)+"%")
	}
	if f.UsernameContains != nil && strings.TrimSpace(*f.UsernameContains) != "" {
		add("u.username ILIKE $%d", "%"+strings.TrimSpace(*f.UsernameContains)+"%")
	}
	if f.EmailContains != nil && strings.TrimSpace(*f.EmailContains) != "" {
		add("u.email::text ILIKE $%d", "%"+strings.TrimSpace(*f.EmailContains)+"%")
	}
	if f.EditorModeExact != nil && f.EditorModeExact.IsValid() {
		add("l.editor_mode = $%d", string(*f.EditorModeExact))
	}
	whereSQL := strings.Join(where, " AND ")
	countSQL := `SELECT COUNT(*)
FROM ai_chat_logs l
LEFT JOIN users u ON u.uid = l.user_uid
LEFT JOIN ai_model_groups g ON g.uid = l.group_uid
LEFT JOIN ai_model_variants v ON v.uid = l.variant_uid
WHERE ` + whereSQL
	var total int
	if err := s.pool.QueryRow(ctx, countSQL, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	argsWithPage := append([]any{}, args...)
	limitPos := len(argsWithPage) + 1
	offsetPos := len(argsWithPage) + 2
	argsWithPage = append(argsWithPage, page.Limit, page.Offset)
	listSQL := `
SELECT
  l.uid, l.created_at, l.user_uid, l.group_uid, l.variant_uid, l.message, l.reply,
  l.user_message_uid, l.assistant_message_uid, l.client_ip, l.user_agent, l.editor_mode, l.note_context,
  u.uid, u.username, u.email,
  g.uid, g.slug, g.label, g.deleted_at,
  v.uid, v.slug, v.label, v.deleted_at
FROM ai_chat_logs l
LEFT JOIN users u ON u.uid = l.user_uid
LEFT JOIN ai_model_groups g ON g.uid = l.group_uid
LEFT JOIN ai_model_variants v ON v.uid = l.variant_uid
WHERE ` + whereSQL + `
ORDER BY l.created_at DESC
LIMIT $` + fmt.Sprint(limitPos) + ` OFFSET $` + fmt.Sprint(offsetPos)
	rows, err := s.pool.Query(ctx, listSQL, argsWithPage...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := make([]domain.AIChatLogItem, 0)
	for rows.Next() {
		var (
			item                             domain.AIChatLogItem
			userUID, groupUID, variantUID    pgtype.UUID
			joinedUserUID, joinedGroupUID    pgtype.UUID
			joinedVariantUID                 pgtype.UUID
			userName, userEmail              *string
			groupSlug, groupLabel            *string
			variantSlug, variantLabel        *string
			groupDeletedAt, variantDeletedAt pgtype.Timestamptz
			clientIP                         *netip.Addr
			userAgent                        *string
			noteContext                      []byte
			editorMode                       string
		)
		if err := rows.Scan(
			&item.Log.UID, &item.Log.CreatedAt, &userUID, &groupUID, &variantUID, &item.Log.Message, &item.Log.Reply,
			&item.Log.UserMessageUID, &item.Log.AssistantMessageUID, &clientIP, &userAgent, &editorMode, &noteContext,
			&joinedUserUID, &userName, &userEmail,
			&joinedGroupUID, &groupSlug, &groupLabel, &groupDeletedAt,
			&joinedVariantUID, &variantSlug, &variantLabel, &variantDeletedAt,
		); err != nil {
			return nil, 0, err
		}
		item.Log.UserUID = pgUUIDPtr(userUID)
		item.Log.GroupUID = pgUUIDPtr(groupUID)
		item.Log.VariantUID = pgUUIDPtr(variantUID)
		item.Log.ClientIP = clientIP
		item.Log.UserAgent = userAgent
		item.Log.EditorMode = domain.EditorMode(editorMode)
		item.Log.NoteContext = noteContext
		if joinedUserUID.Valid && userName != nil && userEmail != nil {
			item.User = &domain.AIChatLogUserRef{UID: joinedUserUID.Bytes, Username: *userName, Email: *userEmail}
		}
		if joinedGroupUID.Valid && groupSlug != nil && groupLabel != nil {
			item.Group = &domain.AIChatLogGroupRef{UID: joinedGroupUID.Bytes, Slug: *groupSlug, Label: *groupLabel, DeletedAt: timePtr(groupDeletedAt)}
		}
		if joinedVariantUID.Valid && variantSlug != nil && variantLabel != nil {
			item.Variant = &domain.AIChatLogVariantRef{UID: joinedVariantUID.Bytes, Slug: *variantSlug, Label: *variantLabel, DeletedAt: timePtr(variantDeletedAt)}
		}
		out = append(out, item)
	}
	return out, total, rows.Err()
}
