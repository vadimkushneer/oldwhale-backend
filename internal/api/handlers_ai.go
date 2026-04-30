package api

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/oldwhale/backend/internal/db"
)

const maxAiChatBodyBytes = 1 << 20
const maxNoteContextBytes = 512 * 1024

const maxAdminEnvLookupNameLen = 256
const maxAdminEnvLookupValueLen = 8192
const maxAdminModelsURLLen = 2048
const maxAdminModelsResponseBytes = 4 << 20

var adminEnvVarNameRe = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

type aiModelProviderAuthScheme string

const (
	aiModelProviderAuthAnthropic aiModelProviderAuthScheme = "anthropic"
	aiModelProviderAuthBearer    aiModelProviderAuthScheme = "bearer"
	aiModelProviderAuthGoogle    aiModelProviderAuthScheme = "google-api-key"
)

type aiModelProvider struct {
	ID         string
	Label      string
	ModelsURL  string
	AuthScheme aiModelProviderAuthScheme
}

var adminAIModelProviders = []aiModelProvider{
	{ID: "openai", Label: "OpenAI", ModelsURL: "https://api.openai.com/v1/models", AuthScheme: aiModelProviderAuthBearer},
	{ID: "anthropic", Label: "Anthropic Claude", ModelsURL: "https://api.anthropic.com/v1/models", AuthScheme: aiModelProviderAuthAnthropic},
	{ID: "google-gemini", Label: "Google Gemini", ModelsURL: "https://generativelanguage.googleapis.com/v1beta/models", AuthScheme: aiModelProviderAuthGoogle},
	{ID: "mistral", Label: "Mistral", ModelsURL: "https://api.mistral.ai/v1/models", AuthScheme: aiModelProviderAuthBearer},
	{ID: "cohere", Label: "Cohere", ModelsURL: "https://api.cohere.com/v1/models", AuthScheme: aiModelProviderAuthBearer},
	{ID: "together-ai", Label: "Together AI", ModelsURL: "https://api.together.xyz/v1/models", AuthScheme: aiModelProviderAuthBearer},
	{ID: "groq", Label: "Groq", ModelsURL: "https://api.groq.com/openai/v1/models", AuthScheme: aiModelProviderAuthBearer},
	{ID: "fireworks", Label: "Fireworks", ModelsURL: "https://api.fireworks.ai/inference/v1/models", AuthScheme: aiModelProviderAuthBearer},
	{ID: "perplexity", Label: "Perplexity", ModelsURL: "https://api.perplexity.ai/models", AuthScheme: aiModelProviderAuthBearer},
	{ID: "deepseek", Label: "DeepSeek", ModelsURL: "https://api.deepseek.com/models", AuthScheme: aiModelProviderAuthBearer},
}

func isUniqueViolation(err error) bool {
	var pe *pgconn.PgError
	if errors.As(err, &pe) && pe.Code == "23505" {
		return true
	}
	return strings.Contains(err.Error(), "23505")
}

func (s *Server) PublicAIModels(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		jsonErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	groups, variants, err := db.ListAICatalogPublic(s.DB)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, "db error")
		return
	}
	out := make([]map[string]any, 0, len(groups))
	for i := range groups {
		g := groups[i]
		vlist := variants[i]
		vout := make([]map[string]any, 0, len(vlist))
		for j := range vlist {
			v := vlist[j]
			vout = append(vout, map[string]any{
				"id":         v.ID,
				"slug":       v.Slug,
				"label":      v.Label,
				"is_default": v.IsDefault,
			})
		}
		out = append(out, map[string]any{
			"id":       g.ID,
			"slug":     g.Slug,
			"label":    g.Label,
			"role":     g.Role,
			"color":    g.Color,
			"free":     g.Free,
			"variants": vout,
		})
	}
	jsonOK(w, map[string]any{"groups": out})
}

type aiChatReq struct {
	Message     string          `json:"message"`
	GroupSlug   string          `json:"groupSlug"`
	VariantSlug string          `json:"variantSlug"`
	EditorMode  string          `json:"editorMode"`
	NoteContext json.RawMessage `json:"noteContext"`
}

type aiChatConvMsg struct {
	ID           string `json:"id"`
	Role         string `json:"role"`
	Text         string `json:"text"`
	Model        string `json:"model"`
	ModelVariant string `json:"modelVariant"`
}

type aiChatNoteCtx struct {
	ConversationHistory []aiChatConvMsg `json:"conversationHistory"`
	WorkfieldHtml       string          `json:"workfieldHtml"`
}

func normalizeEditorMode(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	if s == "" {
		return "film"
	}
	return s
}

func validEditorMode(s string) bool {
	switch s {
	case "note", "media", "short", "play", "film":
		return true
	default:
		return false
	}
}

func validAiChatRole(role string) bool {
	switch role {
	case "user", "ai", "sys":
		return true
	default:
		return false
	}
}

func randomUUIDv4() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "00000000-0000-4000-8000-000000000000"
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	h := hex.EncodeToString(b)
	return h[0:8] + "-" + h[8:12] + "-" + h[12:16] + "-" + h[16:20] + "-" + h[20:32]
}

func requestClientIP(r *http.Request) string {
	xff := r.Header.Get("X-Forwarded-For")
	if xff != "" {
		for _, p := range strings.Split(xff, ",") {
			p = strings.TrimSpace(p)
			if p != "" {
				return p
			}
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// AIChat is a public stub: validates JSON and returns a fixed reply (no upstream LLM call).
func (s *Server) AIChat(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxAiChatBodyBytes)
	var in aiChatReq
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	in.Message = strings.TrimSpace(in.Message)
	in.GroupSlug = strings.TrimSpace(in.GroupSlug)
	in.VariantSlug = strings.TrimSpace(in.VariantSlug)
	if in.Message == "" || in.GroupSlug == "" || in.VariantSlug == "" {
		jsonErr(w, http.StatusBadRequest, "message, groupSlug, and variantSlug required")
		return
	}
	em := normalizeEditorMode(in.EditorMode)
	if !validEditorMode(em) {
		jsonErr(w, http.StatusBadRequest, "invalid editorMode")
		return
	}
	var noteBytes []byte
	if em == "note" {
		if len(in.NoteContext) == 0 {
			jsonErr(w, http.StatusBadRequest, "noteContext required for note mode")
			return
		}
		if len(in.NoteContext) > maxNoteContextBytes {
			jsonErr(w, http.StatusRequestEntityTooLarge, "noteContext too large")
			return
		}
		var nc aiChatNoteCtx
		if err := json.Unmarshal(in.NoteContext, &nc); err != nil {
			jsonErr(w, http.StatusBadRequest, "invalid noteContext")
			return
		}
		if nc.ConversationHistory == nil {
			jsonErr(w, http.StatusBadRequest, "noteContext.conversationHistory required")
			return
		}
		for i := range nc.ConversationHistory {
			m := nc.ConversationHistory[i]
			if strings.TrimSpace(m.ID) == "" || !validAiChatRole(strings.TrimSpace(m.Role)) {
				jsonErr(w, http.StatusBadRequest, "invalid conversationHistory item")
				return
			}
		}
		var err error
		noteBytes, err = json.Marshal(nc)
		if err != nil {
			jsonErr(w, http.StatusBadRequest, "invalid noteContext")
			return
		}
	}

	reply := "HELLO FROM OLD WHALE"
	userMessageID := randomUUIDv4()
	assistantMessageID := randomUUIDv4()

	var uid *int64
	if id, ok := UserID(r); ok {
		uid = &id
	}
	ipStr := requestClientIP(r)
	uaStr := strings.TrimSpace(r.Header.Get("User-Agent"))
	var ipPtr, uaPtr *string
	if ipStr != "" {
		ipPtr = &ipStr
	}
	if uaStr != "" {
		uaPtr = &uaStr
	}
	if err := db.InsertAIChatLog(s.DB, uid, in.Message, in.GroupSlug, in.VariantSlug, reply, userMessageID, assistantMessageID, ipPtr, uaPtr, em, noteBytes); err != nil {
		log.Printf("ai chat log insert: %v", err)
	}

	jsonOK(w, map[string]any{
		"reply":              reply,
		"userMessageId":      userMessageID,
		"assistantMessageId": assistantMessageID,
	})
}

func (s *Server) AdminListAIChatLogs(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		jsonErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	q := r.URL.Query()

	limit := 50
	if ls := strings.TrimSpace(q.Get("limit")); ls != "" {
		if v, err := strconv.Atoi(ls); err == nil && v > 0 {
			limit = v
		}
	}
	if limit > 200 {
		limit = 200
	}
	offset := 0
	if os := strings.TrimSpace(q.Get("offset")); os != "" {
		if v, err := strconv.Atoi(os); err == nil && v >= 0 {
			offset = v
		}
	}

	var f db.AIChatLogFilters
	if s := strings.TrimSpace(q.Get("id")); s != "" {
		id, err := strconv.ParseInt(s, 10, 64)
		if err != nil || id < 1 {
			jsonErr(w, http.StatusBadRequest, "bad id")
			return
		}
		f.ID = &id
	}
	if s := strings.TrimSpace(q.Get("from")); s != "" {
		t, err := time.Parse(time.RFC3339, s)
		if err != nil {
			jsonErr(w, http.StatusBadRequest, "bad from")
			return
		}
		f.From = &t
	}
	if s := strings.TrimSpace(q.Get("to")); s != "" {
		t, err := time.Parse(time.RFC3339, s)
		if err != nil {
			jsonErr(w, http.StatusBadRequest, "bad to")
			return
		}
		f.To = &t
	}
	if s := strings.TrimSpace(q.Get("user_id")); s != "" {
		id, err := strconv.ParseInt(s, 10, 64)
		if err != nil || id < 1 {
			jsonErr(w, http.StatusBadRequest, "bad user_id")
			return
		}
		f.UserID = &id
	}
	if s := strings.TrimSpace(q.Get("group_slug")); s != "" {
		f.GroupSlugContains = &s
	}
	if s := strings.TrimSpace(q.Get("variant_slug")); s != "" {
		f.VariantSlugContains = &s
	}
	if s := strings.TrimSpace(q.Get("message_contains")); s != "" {
		f.MessageContains = &s
	}
	if s := strings.TrimSpace(q.Get("reply_contains")); s != "" {
		f.ReplyContains = &s
	}
	if s := strings.TrimSpace(q.Get("user_message_id")); s != "" {
		f.UserMessageID = &s
	}
	if s := strings.TrimSpace(q.Get("assistant_message_id")); s != "" {
		f.AssistantMessageID = &s
	}
	if s := strings.TrimSpace(q.Get("client_ip")); s != "" {
		f.ClientIPContains = &s
	}
	if s := strings.TrimSpace(q.Get("user_agent")); s != "" {
		f.UserAgentContains = &s
	}
	if s := strings.TrimSpace(q.Get("login_contains")); s != "" {
		f.LoginContains = &s
	}
	if s := strings.TrimSpace(q.Get("email_contains")); s != "" {
		f.EmailContains = &s
	}
	if s := strings.TrimSpace(q.Get("editor_mode")); s != "" {
		if !validEditorMode(strings.ToLower(s)) {
			jsonErr(w, http.StatusBadRequest, "bad editor_mode")
			return
		}
		sl := strings.ToLower(s)
		f.EditorModeExact = &sl
	}

	rows, total, err := db.ListAIChatLogsAdmin(s.DB, f, limit, offset)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, "db error")
		return
	}

	items := make([]map[string]any, 0, len(rows))
	for i := range rows {
		row := rows[i]
		m := map[string]any{
			"id":                   row.ID,
			"created_at":           row.CreatedAt.UTC().Format(time.RFC3339),
			"message":              row.Message,
			"group_slug":           row.GroupSlug,
			"variant_slug":         row.VariantSlug,
			"reply":                row.Reply,
			"user_message_id":      row.UserMessageID,
			"assistant_message_id": row.AssistantMessageID,
		}
		if row.UserID.Valid {
			m["user_id"] = row.UserID.Int64
		} else {
			m["user_id"] = nil
		}
		if row.ClientIP.Valid {
			m["client_ip"] = row.ClientIP.String
		} else {
			m["client_ip"] = nil
		}
		if row.UserAgent.Valid {
			m["user_agent"] = row.UserAgent.String
		} else {
			m["user_agent"] = nil
		}
		if row.UserLogin.Valid && row.UserEmail.Valid {
			m["user"] = map[string]any{
				"id":    row.UserID.Int64,
				"login": row.UserLogin.String,
				"email": row.UserEmail.String,
			}
		} else {
			m["user"] = nil
		}
		if row.EditorMode.Valid {
			m["editor_mode"] = row.EditorMode.String
		} else {
			m["editor_mode"] = nil
		}
		if len(row.NoteContext) > 0 {
			var parsed any
			if err := json.Unmarshal(row.NoteContext, &parsed); err != nil {
				m["note_context"] = nil
			} else {
				m["note_context"] = parsed
			}
		} else {
			m["note_context"] = nil
		}
		items = append(items, m)
	}
	jsonOK(w, map[string]any{"items": items, "total": total})
}

func (s *Server) AdminListAIGroups(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		jsonErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	groups, variants, err := db.ListAICatalogAdmin(s.DB)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, "db error")
		return
	}
	out := make([]map[string]any, 0, len(groups))
	for i := range groups {
		g := groups[i]
		vlist := variants[i]
		vout := make([]map[string]any, 0, len(vlist))
		for j := range vlist {
			v := vlist[j]
			vout = append(vout, map[string]any{
				"id":         v.ID,
				"group_id":   v.GroupID,
				"slug":       v.Slug,
				"label":      v.Label,
				"is_default": v.IsDefault,
				"position":   v.Position,
				"created_at": v.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
			})
		}
		out = append(out, map[string]any{
			"id":         g.ID,
			"slug":       g.Slug,
			"label":      g.Label,
			"role":       g.Role,
			"color":      g.Color,
			"free":       g.Free,
			"apiKey":     g.APIKey,
			"position":   g.Position,
			"created_at": g.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
			"variants":   vout,
		})
	}
	jsonOK(w, map[string]any{"groups": out})
}

type adminEnvLookupReq struct {
	Name string `json:"name"`
}

func (s *Server) AdminEnvLookup(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var in adminEnvLookupReq
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	name := strings.TrimSpace(in.Name)
	if name == "" || len(name) > maxAdminEnvLookupNameLen || !adminEnvVarNameRe.MatchString(name) {
		jsonErr(w, http.StatusBadRequest, "invalid environment variable name")
		return
	}
	val, ok := os.LookupEnv(name)
	if !ok {
		jsonOK(w, map[string]any{"found": false})
		return
	}
	if len(val) > maxAdminEnvLookupValueLen {
		jsonErr(w, http.StatusBadRequest, "environment variable value too large")
		return
	}
	jsonOK(w, map[string]any{"found": true, "value": val})
}

func (s *Server) AdminListAIModelProviders(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		jsonErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	providers := make([]map[string]any, 0, len(adminAIModelProviders))
	for _, p := range adminAIModelProviders {
		providers = append(providers, map[string]any{
			"id":        p.ID,
			"label":     p.Label,
			"modelsUrl": p.ModelsURL,
		})
	}
	jsonOK(w, map[string]any{"providers": providers})
}

type adminAIModelsImportReq struct {
	ProviderID string `json:"providerId"`
	ModelsURL  string `json:"modelsUrl"`
	EnvVarName string `json:"envVarName"`
}

type upstreamAIModel struct {
	ID          string
	DisplayName string
}

func (s *Server) AdminImportAIModels(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	groupID, ok := parsePathIDSuffix(r.URL.Path, "/api/admin/ai/groups/", "/models/import")
	if !ok {
		jsonErr(w, http.StatusBadRequest, "bad group id")
		return
	}
	var in adminAIModelsImportReq
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	providerID := strings.TrimSpace(in.ProviderID)
	modelsURL, err := validateAdminModelsURL(in.ModelsURL)
	if err != nil {
		jsonErr(w, http.StatusBadRequest, err.Error())
		return
	}
	envVarName := strings.TrimSpace(in.EnvVarName)
	if envVarName == "" || len(envVarName) > maxAdminEnvLookupNameLen || !adminEnvVarNameRe.MatchString(envVarName) {
		jsonErr(w, http.StatusBadRequest, "invalid environment variable name")
		return
	}
	apiKey, ok := os.LookupEnv(envVarName)
	if !ok || strings.TrimSpace(apiKey) == "" {
		jsonErr(w, http.StatusBadRequest, "environment variable not found")
		return
	}
	provider := adminAIModelProviderByID(providerID)
	models, err := requestProviderAIModels(r, provider, modelsURL, apiKey)
	if err != nil {
		jsonErr(w, http.StatusBadGateway, err.Error())
		return
	}
	imported := normalizeProviderModels(models)
	if len(imported) == 0 {
		jsonErr(w, http.StatusBadGateway, "models response did not contain model ids")
		return
	}
	variants, err := db.UpsertAIVariants(s.DB, groupID, imported)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			jsonErr(w, http.StatusNotFound, "group not found")
			return
		}
		jsonErr(w, http.StatusInternalServerError, "db error")
		return
	}
	g, err := db.GetAIGroupByID(s.DB, groupID)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, "db error")
		return
	}
	vout := make([]map[string]any, 0, len(variants))
	for i := range variants {
		vout = append(vout, publicAIVariant(&variants[i]))
	}
	jsonOK(w, map[string]any{
		"group":     publicAIGroup(g, vout),
		"imported":  len(imported),
		"modelsUrl": modelsURL,
	})
}

func adminAIModelProviderByID(id string) aiModelProvider {
	for _, p := range adminAIModelProviders {
		if p.ID == id {
			return p
		}
	}
	return aiModelProvider{
		ID:         strings.TrimSpace(id),
		Label:      "Custom",
		AuthScheme: aiModelProviderAuthAnthropic,
	}
}

func validateAdminModelsURL(raw string) (string, error) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return "", fmt.Errorf("modelsUrl required")
	}
	if len(s) > maxAdminModelsURLLen {
		return "", fmt.Errorf("modelsUrl too long")
	}
	u, err := url.ParseRequestURI(s)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return "", fmt.Errorf("modelsUrl must be a valid URL")
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return "", fmt.Errorf("modelsUrl must use http or https")
	}
	if u.User != nil {
		return "", fmt.Errorf("modelsUrl must not contain credentials")
	}
	return u.String(), nil
}

func requestProviderAIModels(r *http.Request, provider aiModelProvider, modelsURL, apiKey string) ([]upstreamAIModel, error) {
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, modelsURL, nil)
	if err != nil {
		return nil, fmt.Errorf("could not build models request")
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	switch provider.AuthScheme {
	case aiModelProviderAuthGoogle:
		req.Header.Set("x-goog-api-key", apiKey)
	case aiModelProviderAuthAnthropic:
		req.Header.Set("x-api-key", apiKey)
		req.Header.Set("anthropic-version", "2023-06-01")
	default:
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}
	client := &http.Client{Timeout: 20 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("models request failed")
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxAdminModelsResponseBytes+1))
	if err != nil {
		return nil, fmt.Errorf("could not read models response")
	}
	if len(body) > maxAdminModelsResponseBytes {
		return nil, fmt.Errorf("models response too large")
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("models endpoint returned HTTP %d", resp.StatusCode)
	}
	var raw any
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, fmt.Errorf("models response is not valid JSON")
	}
	return extractProviderModels(raw), nil
}

func extractProviderModels(raw any) []upstreamAIModel {
	switch v := raw.(type) {
	case []any:
		return extractProviderModelsFromArray(v)
	case map[string]any:
		for _, key := range []string{"data", "models"} {
			if arr, ok := v[key].([]any); ok {
				return extractProviderModelsFromArray(arr)
			}
		}
	}
	return nil
}

func extractProviderModelsFromArray(items []any) []upstreamAIModel {
	out := make([]upstreamAIModel, 0, len(items))
	for _, item := range items {
		m, ok := item.(map[string]any)
		if !ok {
			continue
		}
		id := firstStringField(m, "id", "name", "model", "slug")
		if id == "" {
			continue
		}
		label := firstStringField(m, "display_name", "displayName", "label", "name")
		out = append(out, upstreamAIModel{ID: id, DisplayName: label})
	}
	return out
}

func firstStringField(m map[string]any, keys ...string) string {
	for _, key := range keys {
		if v, ok := m[key].(string); ok {
			if s := strings.TrimSpace(v); s != "" {
				return s
			}
		}
	}
	return ""
}

func normalizeProviderModels(models []upstreamAIModel) []db.AIImportedVariant {
	out := make([]db.AIImportedVariant, 0, len(models))
	seen := make(map[string]struct{}, len(models))
	for _, m := range models {
		slug := normalizeImportedModelSlug(m.ID)
		if slug == "" {
			continue
		}
		if _, ok := seen[slug]; ok {
			continue
		}
		seen[slug] = struct{}{}
		label := strings.TrimSpace(m.DisplayName)
		if label == "" {
			label = strings.TrimSpace(m.ID)
		}
		out = append(out, db.AIImportedVariant{Slug: slug, Label: label})
	}
	return out
}

func normalizeImportedModelSlug(raw string) string {
	s := strings.ToLower(strings.TrimSpace(raw))
	s = strings.TrimSuffix(s, "/")
	if i := strings.LastIndexByte(s, '/'); i >= 0 {
		s = s[i+1:]
	}
	var b strings.Builder
	lastDash := false
	for i := 0; i < len(s); i++ {
		c := s[i]
		if (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') {
			b.WriteByte(c)
			lastDash = false
			continue
		}
		if !lastDash {
			b.WriteByte('-')
			lastDash = true
		}
	}
	out := strings.Trim(b.String(), "-")
	if _, err := db.ValidateAIModelSlug(out); err != nil {
		return ""
	}
	return out
}

type aiCreateGroupReq struct {
	Slug     string  `json:"slug"`
	Label    string  `json:"label"`
	Role     string  `json:"role"`
	Color    string  `json:"color"`
	Free     *bool   `json:"free"`
	Position *int    `json:"position"`
	ApiKey   *string `json:"apiKey,omitempty"`
}

type aiPatchGroupReq struct {
	Slug     *string `json:"slug"`
	Label    *string `json:"label"`
	Role     *string `json:"role"`
	Color    *string `json:"color"`
	Free     *bool   `json:"free"`
	Position *int    `json:"position"`
	ApiKey   *string `json:"apiKey,omitempty"`
}

type aiReorderReq struct {
	IDs []int64 `json:"ids"`
}

type aiCreateVariantReq struct {
	Slug      string `json:"slug"`
	Label     string `json:"label"`
	IsDefault *bool  `json:"is_default"`
	Position  *int   `json:"position"`
}

type aiPatchVariantReq struct {
	Slug      *string `json:"slug"`
	Label     *string `json:"label"`
	IsDefault *bool   `json:"is_default"`
	Position  *int    `json:"position"`
}

func (s *Server) AdminCreateAIGroup(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var in aiCreateGroupReq
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	slug, err := db.ValidateAIModelSlug(in.Slug)
	if err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid slug")
		return
	}
	in.Label = strings.TrimSpace(in.Label)
	if in.Label == "" {
		jsonErr(w, http.StatusBadRequest, "label required")
		return
	}
	color, err := db.ValidateAIColor(in.Color)
	if err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid color")
		return
	}
	free := false
	if in.Free != nil {
		free = *in.Free
	}
	apiKey := ""
	if in.ApiKey != nil {
		apiKey = strings.TrimSpace(*in.ApiKey)
	}
	g, err := db.CreateAIGroup(s.DB, slug, in.Label, strings.TrimSpace(in.Role), color, free, in.Position, apiKey)
	if err != nil {
		if isUniqueViolation(err) {
			jsonErr(w, http.StatusConflict, "slug taken")
			return
		}
		jsonErr(w, http.StatusInternalServerError, "db error")
		return
	}
	jsonOK(w, map[string]any{"group": publicAIGroup(g, nil)})
}

func publicAIGroup(g *db.AIModelGroup, variants []map[string]any) map[string]any {
	m := map[string]any{
		"id":         g.ID,
		"slug":       g.Slug,
		"label":      g.Label,
		"role":       g.Role,
		"color":      g.Color,
		"free":       g.Free,
		"apiKey":     g.APIKey,
		"position":   g.Position,
		"created_at": g.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
	}
	if variants != nil {
		m["variants"] = variants
	}
	return m
}

func (s *Server) AdminPatchAIGroup(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPatch {
		jsonErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	id, ok := parsePathID(r.URL.Path, "/api/admin/ai/groups/")
	if !ok {
		jsonErr(w, http.StatusBadRequest, "bad id")
		return
	}
	var in aiPatchGroupReq
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	var slug, label, role, color *string
	if in.Slug != nil {
		sl, err := db.ValidateAIModelSlug(*in.Slug)
		if err != nil {
			jsonErr(w, http.StatusBadRequest, "invalid slug")
			return
		}
		slug = &sl
	}
	if in.Label != nil {
		t := strings.TrimSpace(*in.Label)
		if t == "" {
			jsonErr(w, http.StatusBadRequest, "label empty")
			return
		}
		label = &t
	}
	if in.Role != nil {
		t := strings.TrimSpace(*in.Role)
		role = &t
	}
	if in.Color != nil {
		c, err := db.ValidateAIColor(*in.Color)
		if err != nil {
			jsonErr(w, http.StatusBadRequest, "invalid color")
			return
		}
		color = &c
	}
	var apiKey *string
	if in.ApiKey != nil {
		t := strings.TrimSpace(*in.ApiKey)
		apiKey = &t
	}
	g, err := db.UpdateAIGroup(s.DB, id, slug, label, role, color, in.Free, in.Position, apiKey)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			jsonErr(w, http.StatusNotFound, "not found")
			return
		}
		if isUniqueViolation(err) {
			jsonErr(w, http.StatusConflict, "slug taken")
			return
		}
		jsonErr(w, http.StatusInternalServerError, "db error")
		return
	}
	jsonOK(w, map[string]any{"group": publicAIGroup(g, nil)})
}

func (s *Server) AdminDeleteAIGroup(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		jsonErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	id, ok := parsePathID(r.URL.Path, "/api/admin/ai/groups/")
	if !ok {
		jsonErr(w, http.StatusBadRequest, "bad id")
		return
	}
	if err := db.DeleteAIGroup(s.DB, id); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			jsonErr(w, http.StatusNotFound, "not found")
			return
		}
		jsonErr(w, http.StatusInternalServerError, "db error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) AdminReorderAIGroups(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		jsonErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var in aiReorderReq
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if len(in.IDs) == 0 {
		jsonErr(w, http.StatusBadRequest, "ids required")
		return
	}
	if err := db.ReorderAIGroups(s.DB, in.IDs); err != nil {
		jsonErr(w, http.StatusInternalServerError, "db error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) AdminCreateAIVariant(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	const pfx = "/api/admin/ai/groups/"
	if !strings.HasPrefix(r.URL.Path, pfx) || !strings.HasSuffix(r.URL.Path, "/variants") {
		jsonErr(w, http.StatusBadRequest, "bad path")
		return
	}
	mid := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, pfx), "/variants")
	mid = strings.TrimSuffix(mid, "/")
	gid, err := strconv.ParseInt(mid, 10, 64)
	if err != nil || gid < 1 {
		jsonErr(w, http.StatusBadRequest, "bad group id")
		return
	}
	var in aiCreateVariantReq
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	slug, err := db.ValidateAIModelSlug(in.Slug)
	if err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid slug")
		return
	}
	def := false
	if in.IsDefault != nil {
		def = *in.IsDefault
	}
	v, err := db.CreateAIVariant(s.DB, gid, slug, in.Label, def, in.Position)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			jsonErr(w, http.StatusNotFound, "group not found")
			return
		}
		if isUniqueViolation(err) {
			jsonErr(w, http.StatusConflict, "slug taken")
			return
		}
		jsonErr(w, http.StatusInternalServerError, "db error")
		return
	}
	jsonOK(w, map[string]any{"variant": publicAIVariant(v)})
}

func publicAIVariant(v *db.AIModelVariant) map[string]any {
	return map[string]any{
		"id":         v.ID,
		"group_id":   v.GroupID,
		"slug":       v.Slug,
		"label":      v.Label,
		"is_default": v.IsDefault,
		"position":   v.Position,
		"created_at": v.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
	}
}

func (s *Server) AdminReorderAIVariants(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		jsonErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	const pfx = "/api/admin/ai/groups/"
	const suf = "/variants/order"
	if !strings.HasPrefix(r.URL.Path, pfx) || !strings.HasSuffix(r.URL.Path, suf) {
		jsonErr(w, http.StatusBadRequest, "bad path")
		return
	}
	mid := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, pfx), suf)
	mid = strings.TrimSuffix(mid, "/")
	gid, err := strconv.ParseInt(mid, 10, 64)
	if err != nil || gid < 1 {
		jsonErr(w, http.StatusBadRequest, "bad group id")
		return
	}
	var in aiReorderReq
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if len(in.IDs) == 0 {
		jsonErr(w, http.StatusBadRequest, "ids required")
		return
	}
	if err := db.ReorderAIVariants(s.DB, gid, in.IDs); err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid reorder")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) AdminPatchAIVariant(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPatch {
		jsonErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	id, ok := parsePathID(r.URL.Path, "/api/admin/ai/variants/")
	if !ok {
		jsonErr(w, http.StatusBadRequest, "bad id")
		return
	}
	var in aiPatchVariantReq
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	var slug, label *string
	if in.Slug != nil {
		sl, err := db.ValidateAIModelSlug(*in.Slug)
		if err != nil {
			jsonErr(w, http.StatusBadRequest, "invalid slug")
			return
		}
		slug = &sl
	}
	if in.Label != nil {
		label = in.Label
	}
	v, err := db.UpdateAIVariant(s.DB, id, slug, label, in.IsDefault, in.Position)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			jsonErr(w, http.StatusNotFound, "not found")
			return
		}
		if isUniqueViolation(err) {
			jsonErr(w, http.StatusConflict, "slug taken")
			return
		}
		jsonErr(w, http.StatusInternalServerError, "db error")
		return
	}
	jsonOK(w, map[string]any{"variant": publicAIVariant(v)})
}

func (s *Server) AdminDeleteAIVariant(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		jsonErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	id, ok := parsePathID(r.URL.Path, "/api/admin/ai/variants/")
	if !ok {
		jsonErr(w, http.StatusBadRequest, "bad id")
		return
	}
	if err := db.DeleteAIVariant(s.DB, id); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			jsonErr(w, http.StatusNotFound, "not found")
			return
		}
		jsonErr(w, http.StatusInternalServerError, "db error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// parsePathID extracts int64 after prefix, path must be /prefix{id} or /prefix{id}/...
func parsePathID(path, prefix string) (int64, bool) {
	if !strings.HasPrefix(path, prefix) {
		return 0, false
	}
	rest := strings.TrimPrefix(path, prefix)
	rest = strings.TrimSuffix(rest, "/")
	part := rest
	if i := strings.IndexByte(rest, '/'); i >= 0 {
		part = rest[:i]
	}
	if part == "" {
		return 0, false
	}
	id, err := strconv.ParseInt(part, 10, 64)
	if err != nil || id < 1 {
		return 0, false
	}
	return id, true
}

func parsePathIDSuffix(path, prefix, suffix string) (int64, bool) {
	if !strings.HasPrefix(path, prefix) || !strings.HasSuffix(path, suffix) {
		return 0, false
	}
	part := strings.TrimSuffix(strings.TrimPrefix(path, prefix), suffix)
	part = strings.Trim(part, "/")
	if part == "" || strings.Contains(part, "/") {
		return 0, false
	}
	id, err := strconv.ParseInt(part, 10, 64)
	if err != nil || id < 1 {
		return 0, false
	}
	return id, true
}
