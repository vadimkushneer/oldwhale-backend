package db

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// AIChatLogRow is one persisted chat exchange for admin listing.
type AIChatLogRow struct {
	ID                 int64
	CreatedAt          time.Time
	UserID             sql.NullInt64
	Message            string
	GroupSlug          string
	VariantSlug        string
	Reply              string
	UserMessageID      string
	AssistantMessageID string
	ClientIP           sql.NullString
	UserAgent          sql.NullString
	UserLogin          sql.NullString
	UserEmail          sql.NullString
	EditorMode  sql.NullString
	NoteContext []byte
}

// AIChatLogFilters are optional AND-combined filters for admin listing.
type AIChatLogFilters struct {
	ID                  *int64
	From                *time.Time
	To                  *time.Time
	UserID              *int64
	GroupSlugContains   *string
	VariantSlugContains *string
	MessageContains     *string
	ReplyContains       *string
	UserMessageID       *string
	AssistantMessageID  *string
	ClientIPContains    *string
	UserAgentContains   *string
	LoginContains       *string
	EmailContains       *string
	EditorModeExact     *string
}

func (d *Database) migrateAIChatLogs() error {
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS ai_chat_logs (
	id BIGSERIAL PRIMARY KEY,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
	message TEXT NOT NULL,
	group_slug TEXT NOT NULL,
	variant_slug TEXT NOT NULL,
	reply TEXT NOT NULL,
	user_message_id TEXT NOT NULL,
	assistant_message_id TEXT NOT NULL,
	client_ip TEXT,
	user_agent TEXT
)`,
		`CREATE INDEX IF NOT EXISTS idx_ai_chat_logs_created ON ai_chat_logs(created_at DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_ai_chat_logs_user ON ai_chat_logs(user_id)`,
		`CREATE INDEX IF NOT EXISTS idx_ai_chat_logs_group ON ai_chat_logs(group_slug)`,
		`CREATE INDEX IF NOT EXISTS idx_ai_chat_logs_variant ON ai_chat_logs(variant_slug)`,
		`ALTER TABLE ai_chat_logs ADD COLUMN IF NOT EXISTS editor_mode TEXT`,
		`ALTER TABLE ai_chat_logs ADD COLUMN IF NOT EXISTS note_context JSONB`,
		`CREATE INDEX IF NOT EXISTS idx_ai_chat_logs_editor_mode ON ai_chat_logs(editor_mode)`,
	}
	for _, s := range stmts {
		if _, err := d.Exec(s); err != nil {
			return err
		}
	}
	return nil
}

// InsertAIChatLog stores one completed chat exchange. noteContextJSON must be valid JSON or nil.
func InsertAIChatLog(d *Database, userID *int64, message, groupSlug, variantSlug, reply, userMsgID, asstMsgID string, clientIP, userAgent *string, editorMode string, noteContextJSON []byte) error {
	var uid sql.NullInt64
	if userID != nil {
		uid = sql.NullInt64{Int64: *userID, Valid: true}
	}
	var ip, ua sql.NullString
	if clientIP != nil && *clientIP != "" {
		ip = sql.NullString{String: *clientIP, Valid: true}
	}
	if userAgent != nil && *userAgent != "" {
		ua = sql.NullString{String: *userAgent, Valid: true}
	}
	em := strings.TrimSpace(editorMode)
	if em == "" {
		em = "film"
	}
	var note any
	if len(noteContextJSON) > 0 {
		if !json.Valid(noteContextJSON) {
			noteContextJSON = []byte(`{}`)
		}
		note = noteContextJSON
	}
	_, err := d.Exec(
		`INSERT INTO ai_chat_logs (user_id, message, group_slug, variant_slug, reply, user_message_id, assistant_message_id, client_ip, user_agent, editor_mode, note_context)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
		uid, message, groupSlug, variantSlug, reply, userMsgID, asstMsgID, ip, ua, em, note,
	)
	return err
}

// ListAIChatLogsAdmin returns paginated rows with optional user join for login/email.
func ListAIChatLogsAdmin(d *Database, f AIChatLogFilters, limit, offset int) ([]AIChatLogRow, int, error) {
	where := []string{"1=1"}
	args := []any{}
	n := 1

	add := func(cond string, v any) {
		where = append(where, cond)
		args = append(args, v)
		n++
	}

	if f.ID != nil {
		add(fmt.Sprintf("l.id = $%d", n), *f.ID)
	}
	if f.From != nil {
		add(fmt.Sprintf("l.created_at >= $%d", n), *f.From)
	}
	if f.To != nil {
		add(fmt.Sprintf("l.created_at <= $%d", n), *f.To)
	}
	if f.UserID != nil {
		add(fmt.Sprintf("l.user_id = $%d", n), *f.UserID)
	}
	if f.GroupSlugContains != nil && *f.GroupSlugContains != "" {
		add(fmt.Sprintf("l.group_slug ILIKE $%d", n), "%"+*f.GroupSlugContains+"%")
	}
	if f.VariantSlugContains != nil && *f.VariantSlugContains != "" {
		add(fmt.Sprintf("l.variant_slug ILIKE $%d", n), "%"+*f.VariantSlugContains+"%")
	}
	if f.MessageContains != nil && *f.MessageContains != "" {
		add(fmt.Sprintf("l.message ILIKE $%d", n), "%"+*f.MessageContains+"%")
	}
	if f.ReplyContains != nil && *f.ReplyContains != "" {
		add(fmt.Sprintf("l.reply ILIKE $%d", n), "%"+*f.ReplyContains+"%")
	}
	if f.UserMessageID != nil && *f.UserMessageID != "" {
		add(fmt.Sprintf("l.user_message_id ILIKE $%d", n), "%"+*f.UserMessageID+"%")
	}
	if f.AssistantMessageID != nil && *f.AssistantMessageID != "" {
		add(fmt.Sprintf("l.assistant_message_id ILIKE $%d", n), "%"+*f.AssistantMessageID+"%")
	}
	if f.ClientIPContains != nil && *f.ClientIPContains != "" {
		add(fmt.Sprintf("l.client_ip ILIKE $%d", n), "%"+*f.ClientIPContains+"%")
	}
	if f.UserAgentContains != nil && *f.UserAgentContains != "" {
		add(fmt.Sprintf("l.user_agent ILIKE $%d", n), "%"+*f.UserAgentContains+"%")
	}
	if f.LoginContains != nil && *f.LoginContains != "" {
		add(fmt.Sprintf("u.login ILIKE $%d", n), "%"+*f.LoginContains+"%")
	}
	if f.EmailContains != nil && *f.EmailContains != "" {
		add(fmt.Sprintf("u.email ILIKE $%d", n), "%"+*f.EmailContains+"%")
	}
	if f.EditorModeExact != nil && *f.EditorModeExact != "" {
		add(fmt.Sprintf("l.editor_mode = $%d", n), *f.EditorModeExact)
	}

	whereSQL := strings.Join(where, " AND ")
	countQuery := `SELECT COUNT(*) FROM ai_chat_logs l LEFT JOIN users u ON u.id = l.user_id WHERE ` + whereSQL

	var total int
	if err := d.QueryRow(countQuery, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	argsWithPage := append([]any{}, args...)
	argsWithPage = append(argsWithPage, limit, offset)
	limitPos := n
	offsetPos := n + 1

	listQuery := `
SELECT l.id, l.created_at, l.user_id, l.message, l.group_slug, l.variant_slug, l.reply,
	l.user_message_id, l.assistant_message_id, l.client_ip, l.user_agent, u.login, u.email,
	l.editor_mode, l.note_context
FROM ai_chat_logs l
LEFT JOIN users u ON u.id = l.user_id
WHERE ` + whereSQL + `
ORDER BY l.created_at DESC
LIMIT $` + fmt.Sprint(limitPos) + ` OFFSET $` + fmt.Sprint(offsetPos)

	rows, err := d.Query(listQuery, argsWithPage...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	out := make([]AIChatLogRow, 0)
	for rows.Next() {
		var r AIChatLogRow
		if err := rows.Scan(
			&r.ID, &r.CreatedAt, &r.UserID, &r.Message, &r.GroupSlug, &r.VariantSlug, &r.Reply,
			&r.UserMessageID, &r.AssistantMessageID, &r.ClientIP, &r.UserAgent, &r.UserLogin, &r.UserEmail,
			&r.EditorMode, &r.NoteContext,
		); err != nil {
			return nil, 0, err
		}
		out = append(out, r)
	}
	return out, total, rows.Err()
}
