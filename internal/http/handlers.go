package http

import (
	"encoding/json"
	"fmt"
	"net"
	stdhttp "net/http"
	"net/netip"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/oldwhale/backend/internal/auth"
	"github.com/oldwhale/backend/internal/domain"
	apigen "github.com/oldwhale/backend/internal/http/generated"
	"github.com/oldwhale/backend/internal/service"
)

const maxAIChatBodyBytes = 1 << 20

type Handlers struct {
	Pool      *pgxpool.Pool
	Users     *service.UserService
	Catalog   *service.AICatalogService
	Chat      *service.AIChatService
	ChatLogs  *service.AIChatLogService
	AdminUI   *service.AdminUIService
	Secrets   *service.SecretsService
	JWTSecret []byte
	JWTTTL    time.Duration
}

func NewHandlers(pool *pgxpool.Pool, users *service.UserService, catalog *service.AICatalogService, chat *service.AIChatService, chatLogs *service.AIChatLogService, ui *service.AdminUIService, secrets *service.SecretsService, jwtSecret []byte, jwtTTL time.Duration) *Handlers {
	return &Handlers{Pool: pool, Users: users, Catalog: catalog, Chat: chat, ChatLogs: chatLogs, AdminUI: ui, Secrets: secrets, JWTSecret: jwtSecret, JWTTTL: jwtTTL}
}

func (h *Handlers) GetHealth(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	if err := h.Pool.Ping(r.Context()); err != nil {
		jsonErr(w, stdhttp.StatusServiceUnavailable, "db unavailable")
		return
	}
	jsonOK(w, apigen.HealthOK{Status: "ok"})
}

func (h *Handlers) PostAuthRegister(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	var in apigen.PostAuthRegisterJSONRequestBody
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		jsonErr(w, stdhttp.StatusBadRequest, "invalid json")
		return
	}
	u, err := h.Users.Register(r.Context(), in.Username, string(in.Email), in.Password)
	if err != nil {
		serviceErr(w, err)
		return
	}
	token, err := auth.SignJWT(h.JWTSecret, u.UID, string(u.Role), h.JWTTTL)
	if err != nil {
		jsonErr(w, stdhttp.StatusInternalServerError, "token error")
		return
	}
	jsonOK(w, apigen.AuthTokenResponse{Token: token, User: DomainToAPIUser(u)})
}

func (h *Handlers) PostAuthLogin(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	var in apigen.PostAuthLoginJSONRequestBody
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		jsonErr(w, stdhttp.StatusBadRequest, "invalid json")
		return
	}
	u, err := h.Users.Login(r.Context(), in.Username, in.Password)
	if err != nil {
		serviceErr(w, err)
		return
	}
	token, err := auth.SignJWT(h.JWTSecret, u.UID, string(u.Role), h.JWTTTL)
	if err != nil {
		jsonErr(w, stdhttp.StatusInternalServerError, "token error")
		return
	}
	jsonOK(w, apigen.AuthTokenResponse{Token: token, User: DomainToAPIUser(u)})
}

func (h *Handlers) GetMe(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	uid, ok := UserUID(r)
	if !ok {
		jsonErr(w, stdhttp.StatusUnauthorized, "unauthorized")
		return
	}
	u, err := h.Users.GetByUID(r.Context(), uid)
	if err != nil {
		serviceErr(w, err)
		return
	}
	if u.Disabled {
		jsonErr(w, stdhttp.StatusUnauthorized, "unauthorized")
		return
	}
	jsonOK(w, DomainToAPIUser(u))
}

func (h *Handlers) GetAdminUsers(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	users, err := h.Users.List(r.Context(), service.Page{Limit: 500})
	if err != nil {
		serviceErr(w, err)
		return
	}
	out := make([]apigen.User, 0, len(users))
	for _, u := range users {
		out = append(out, DomainToAPIUser(u))
	}
	jsonOK(w, apigen.UserListResponse{Users: out})
}

func (h *Handlers) PostAdminUsers(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	var in apigen.PostAdminUsersJSONRequestBody
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		jsonErr(w, stdhttp.StatusBadRequest, "invalid json")
		return
	}
	role := domain.RoleUser
	if in.Role != nil {
		role = domain.UserRole(*in.Role)
	}
	u, err := h.Users.AdminCreate(r.Context(), service.CreateUserInput{Username: in.Username, Email: string(in.Email), Password: in.Password, Role: role})
	if err != nil {
		serviceErr(w, err)
		return
	}
	jsonOK(w, apigen.UserWrapResponse{User: DomainToAPIUser(u)})
}

func (h *Handlers) PatchAdminUser(w stdhttp.ResponseWriter, r *stdhttp.Request, uid openapi_types.UUID) {
	if !h.requireAdmin(w, r) {
		return
	}
	var in apigen.PatchAdminUserJSONRequestBody
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		jsonErr(w, stdhttp.StatusBadRequest, "invalid json")
		return
	}
	var role *domain.UserRole
	if in.Role != nil {
		v := domain.UserRole(*in.Role)
		role = &v
	}
	u, err := h.Users.Patch(r.Context(), uuid.UUID(uid), in.Disabled, role)
	if err != nil {
		serviceErr(w, err)
		return
	}
	jsonOK(w, apigen.UserWrapResponse{User: DomainToAPIUser(u)})
}

func (h *Handlers) DeleteAdminUser(w stdhttp.ResponseWriter, r *stdhttp.Request, uid openapi_types.UUID) {
	self, ok := UserUID(r)
	if !ok || UserRole(r) != "admin" {
		jsonErr(w, stdhttp.StatusForbidden, "admin only")
		return
	}
	if self == uuid.UUID(uid) {
		jsonErr(w, stdhttp.StatusBadRequest, "cannot delete self")
		return
	}
	if err := h.Users.Delete(r.Context(), uuid.UUID(uid)); err != nil {
		serviceErr(w, err)
		return
	}
	w.WriteHeader(stdhttp.StatusNoContent)
}

func (h *Handlers) GetPublicAIModels(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	_, authenticated := UserUID(r)
	groups, err := h.Catalog.ListPublicCatalog(r.Context(), authenticated)
	if err != nil {
		serviceErr(w, err)
		return
	}
	jsonOK(w, DomainToAPIPublicCatalog(groups, true))
}

func (h *Handlers) GetAdminAIGroups(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	groups, err := h.Catalog.ListGroupsAdmin(r.Context())
	if err != nil {
		serviceErr(w, err)
		return
	}
	out := make([]apigen.AiGroupAdmin, 0, len(groups))
	for _, g := range groups {
		out = append(out, DomainToAPIGroupAdmin(g))
	}
	jsonOK(w, apigen.AiGroupListAdminResponse{Groups: out})
}

func (h *Handlers) PostAdminAIGroup(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	var in apigen.PostAdminAIGroupJSONRequestBody
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		jsonErr(w, stdhttp.StatusBadRequest, "invalid json")
		return
	}
	group, err := h.Catalog.CreateGroup(r.Context(), service.CreateGroupInput{
		Slug:         in.Slug,
		Label:        in.Label,
		Role:         strVal(in.Role),
		Color:        strVal(in.Color),
		Free:         boolVal(in.Free),
		Position:     in.Position,
		APIKeyEnvVar: strVal(in.ApiKeyEnvVar),
	})
	if err != nil {
		serviceErr(w, err)
		return
	}
	jsonOK(w, apigen.AiGroupWrapResponse{Group: DomainToAPIGroupAdmin(h.Catalog.GroupAdminView(group))})
}

func (h *Handlers) PatchAdminAIGroup(w stdhttp.ResponseWriter, r *stdhttp.Request, uid openapi_types.UUID) {
	if !h.requireAdmin(w, r) {
		return
	}
	var in apigen.PatchAdminAIGroupJSONRequestBody
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		jsonErr(w, stdhttp.StatusBadRequest, "invalid json")
		return
	}
	group, err := h.Catalog.PatchGroup(r.Context(), uuid.UUID(uid), service.PatchGroupInput{
		Slug:         in.Slug,
		Label:        in.Label,
		Role:         in.Role,
		Color:        in.Color,
		Free:         in.Free,
		Position:     in.Position,
		APIKeyEnvVar: in.ApiKeyEnvVar,
	})
	if err != nil {
		serviceErr(w, err)
		return
	}
	jsonOK(w, apigen.AiGroupWrapResponse{Group: DomainToAPIGroupAdmin(h.Catalog.GroupAdminView(group))})
}

func (h *Handlers) DeleteAdminAIGroup(w stdhttp.ResponseWriter, r *stdhttp.Request, uid openapi_types.UUID) {
	if !h.requireAdmin(w, r) {
		return
	}
	if err := h.Catalog.SoftDeleteGroup(r.Context(), uuid.UUID(uid)); err != nil {
		serviceErr(w, err)
		return
	}
	w.WriteHeader(stdhttp.StatusNoContent)
}

func (h *Handlers) PutAdminAIGroupsOrder(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	var in apigen.PutAdminAIGroupsOrderJSONRequestBody
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		jsonErr(w, stdhttp.StatusBadRequest, "invalid json")
		return
	}
	if err := h.Catalog.ReorderGroups(r.Context(), uuids(in.Uids)); err != nil {
		serviceErr(w, err)
		return
	}
	w.WriteHeader(stdhttp.StatusNoContent)
}

func (h *Handlers) PostAdminAIVariant(w stdhttp.ResponseWriter, r *stdhttp.Request, uid openapi_types.UUID) {
	if !h.requireAdmin(w, r) {
		return
	}
	var in apigen.PostAdminAIVariantJSONRequestBody
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		jsonErr(w, stdhttp.StatusBadRequest, "invalid json")
		return
	}
	v, err := h.Catalog.CreateVariant(r.Context(), service.CreateVariantInput{
		GroupUID:        uuid.UUID(uid),
		Slug:            in.Slug,
		ProviderModelID: in.ProviderModelId,
		Label:           strVal(in.Label),
		IsDefault:       boolVal(in.IsDefault),
		Position:        in.Position,
	})
	if err != nil {
		serviceErr(w, err)
		return
	}
	jsonOK(w, apigen.AiVariantWrapResponse{Variant: DomainToAPIVariantAdmin(v)})
}

func (h *Handlers) PatchAdminAIVariant(w stdhttp.ResponseWriter, r *stdhttp.Request, uid openapi_types.UUID) {
	if !h.requireAdmin(w, r) {
		return
	}
	var in apigen.PatchAdminAIVariantJSONRequestBody
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		jsonErr(w, stdhttp.StatusBadRequest, "invalid json")
		return
	}
	v, err := h.Catalog.PatchVariant(r.Context(), uuid.UUID(uid), service.PatchVariantInput{
		Slug:              in.Slug,
		ProviderModelID:   in.ProviderModelId,
		Label:             in.Label,
		IsDefault:         in.IsDefault,
		Position:          in.Position,
	})
	if err != nil {
		serviceErr(w, err)
		return
	}
	jsonOK(w, apigen.AiVariantWrapResponse{Variant: DomainToAPIVariantAdmin(v)})
}

func (h *Handlers) DeleteAdminAIVariant(w stdhttp.ResponseWriter, r *stdhttp.Request, uid openapi_types.UUID) {
	if !h.requireAdmin(w, r) {
		return
	}
	if err := h.Catalog.SoftDeleteVariant(r.Context(), uuid.UUID(uid)); err != nil {
		serviceErr(w, err)
		return
	}
	w.WriteHeader(stdhttp.StatusNoContent)
}

func (h *Handlers) PutAdminAIVariantsOrder(w stdhttp.ResponseWriter, r *stdhttp.Request, uid openapi_types.UUID) {
	if !h.requireAdmin(w, r) {
		return
	}
	var in apigen.PutAdminAIVariantsOrderJSONRequestBody
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		jsonErr(w, stdhttp.StatusBadRequest, "invalid json")
		return
	}
	if err := h.Catalog.ReorderVariants(r.Context(), uuid.UUID(uid), uuids(in.Uids)); err != nil {
		serviceErr(w, err)
		return
	}
	w.WriteHeader(stdhttp.StatusNoContent)
}

func (h *Handlers) GetAdminAIModelProviders(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	providers := h.Catalog.ModelProviders()
	out := make([]apigen.AiModelProvider, 0, len(providers))
	for _, p := range providers {
		out = append(out, apigen.AiModelProvider{Id: p.ID, Label: p.Label, ModelsUrl: p.ModelsURL})
	}
	jsonOK(w, apigen.AiModelProviderListResponse{Providers: out})
}

func (h *Handlers) PostAdminAIGroupModelsImport(w stdhttp.ResponseWriter, r *stdhttp.Request, uid openapi_types.UUID) {
	if !h.requireAdmin(w, r) {
		return
	}
	var in apigen.PostAdminAIGroupModelsImportJSONRequestBody
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		jsonErr(w, stdhttp.StatusBadRequest, "invalid json")
		return
	}
	view, imported, modelsURL, err := h.Catalog.ImportProviderModels(r.Context(), uuid.UUID(uid), in.ProviderId, in.ModelsUrl, in.EnvVarName)
	if err != nil {
		serviceErr(w, err)
		return
	}
	jsonOK(w, apigen.AiModelsImportResponse{Group: DomainToAPIGroupAdmin(view), Imported: imported, ModelsUrl: modelsURL})
}

func (h *Handlers) PostAdminAiEnvCheck(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	var in apigen.PostAdminAiEnvCheckJSONRequestBody
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		jsonErr(w, stdhttp.StatusBadRequest, "invalid json")
		return
	}
	name, present, err := h.Secrets.CheckByName(in.Name)
	if err != nil {
		serviceErr(w, err)
		return
	}
	jsonOK(w, apigen.AdminEnvCheckResponse{Name: name, Present: present})
}

func (h *Handlers) PostAiChat(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	r.Body = stdhttp.MaxBytesReader(w, r.Body, maxAIChatBodyBytes)
	var in apigen.PostAiChatJSONRequestBody
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		jsonErr(w, stdhttp.StatusBadRequest, "invalid json")
		return
	}
	var userUID *uuid.UUID
	if uid, ok := UserUID(r); ok {
		userUID = &uid
	}
	mode := domain.EditorModeFilm
	if in.EditorMode != nil {
		mode = domain.EditorMode(*in.EditorMode)
	}
	var note json.RawMessage
	if in.NoteContext != nil {
		raw, _ := json.Marshal(in.NoteContext)
		note = raw
	}
	out, err := h.Chat.StartJob(r.Context(), service.StartJobInput{
		UserUID:     userUID,
		GroupUID:    uuid.UUID(in.GroupUid),
		VariantUID:  uuid.UUID(in.VariantUid),
		Message:     in.Message,
		EditorMode:  mode,
		NoteContext: note,
		ClientIP:    requestClientIP(r),
		UserAgent:   requestUserAgent(r),
	})
	if err != nil {
		serviceErr(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(stdhttp.StatusAccepted)
	_ = json.NewEncoder(w).Encode(apigen.AiChatAcceptedResponse{RequestUid: openapi_types.UUID(out.RequestUID), UserMessageUid: openapi_types.UUID(out.UserMessageUID), AssistantMessageUid: openapi_types.UUID(out.AssistantMessageUID)})
}

func (h *Handlers) GetAiChatEvents(w stdhttp.ResponseWriter, r *stdhttp.Request, params apigen.GetAiChatEventsParams) {
	job, ok := h.Chat.Jobs().Get(uuid.UUID(params.RequestUid).String())
	if !ok {
		jsonErr(w, stdhttp.StatusNotFound, "chat request not found")
		return
	}
	select {
	case <-job.Done():
	case <-r.Context().Done():
		return
	}
	w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	if job.Error() != "" {
		writeSSE(w, "error", map[string]any{"request_uid": job.RequestUID, "error": job.Error(), "user_message_uid": job.UserMessageUID, "assistant_message_uid": job.AssistantMessageUID})
		return
	}
	writeSSE(w, "ready", map[string]any{"request_uid": job.RequestUID, "reply": job.Reply(), "user_message_uid": job.UserMessageUID, "assistant_message_uid": job.AssistantMessageUID})
}

func (h *Handlers) GetAdminAIChatLogs(w stdhttp.ResponseWriter, r *stdhttp.Request, params apigen.GetAdminAIChatLogsParams) {
	if !h.requireAdmin(w, r) {
		return
	}
	f := service.AIChatLogFilters{
		UID:                 uuidPtr(params.Uid),
		From:                params.From,
		To:                  params.To,
		UserUID:             uuidPtr(params.UserUid),
		GroupUID:            uuidPtr(params.GroupUid),
		VariantUID:          uuidPtr(params.VariantUid),
		MessageContains:     params.MessageContains,
		ReplyContains:       params.ReplyContains,
		UserMessageUID:      uuidPtr(params.UserMessageUid),
		AssistantMessageUID: uuidPtr(params.AssistantMessageUid),
		ClientIPContains:    params.ClientIp,
		UserAgentContains:   params.UserAgent,
		UsernameContains:    params.UsernameContains,
		EmailContains:       params.EmailContains,
	}
	if params.EditorMode != nil {
		mode := domain.EditorMode(*params.EditorMode)
		f.EditorModeExact = &mode
	}
	limit, offset := 50, 0
	if params.Limit != nil {
		limit = *params.Limit
	}
	if params.Offset != nil {
		offset = *params.Offset
	}
	items, total, err := h.ChatLogs.ListAdmin(r.Context(), f, service.Page{Limit: limit, Offset: offset})
	if err != nil {
		serviceErr(w, err)
		return
	}
	out := make([]apigen.AiChatLogItem, 0, len(items))
	for _, item := range items {
		out = append(out, DomainToAPIChatLogItem(item))
	}
	jsonOK(w, apigen.AiChatLogListResponse{Items: out, Total: total})
}

func (h *Handlers) GetAdminMeUiSettings(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	uid, ok := h.requireAdminUID(w, r)
	if !ok {
		return
	}
	prefs, err := h.AdminUI.GetForUser(r.Context(), uid)
	if err != nil {
		serviceErr(w, err)
		return
	}
	jsonOK(w, DomainToAPIUIPreferences(prefs))
}

func (h *Handlers) PutAdminMeUiSettings(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	uid, ok := h.requireAdminUID(w, r)
	if !ok {
		return
	}
	var in apigen.PutAdminMeUiSettingsJSONRequestBody
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		jsonErr(w, stdhttp.StatusBadRequest, "invalid json")
		return
	}
	prefs, err := h.AdminUI.MergeAIChatLogTableColumns(r.Context(), uid, in.AiChatLogTable.Columns)
	if err != nil {
		serviceErr(w, err)
		return
	}
	jsonOK(w, DomainToAPIUIPreferences(prefs))
}

func (h *Handlers) requireAdmin(w stdhttp.ResponseWriter, r *stdhttp.Request) bool {
	_, ok := h.requireAdminUID(w, r)
	return ok
}

func (h *Handlers) requireAdminUID(w stdhttp.ResponseWriter, r *stdhttp.Request) (uuid.UUID, bool) {
	uid, ok := UserUID(r)
	if !ok {
		jsonErr(w, stdhttp.StatusUnauthorized, "unauthorized")
		return uuid.Nil, false
	}
	if UserRole(r) != "admin" {
		jsonErr(w, stdhttp.StatusForbidden, "admin only")
		return uuid.Nil, false
	}
	return uid, true
}

func writeSSE(w stdhttp.ResponseWriter, event string, data any) {
	raw, err := json.Marshal(data)
	if err != nil {
		raw = []byte(`{"error":"event encoding failed"}`)
	}
	_, _ = fmt.Fprintf(w, "event: %s\n", event)
	_, _ = fmt.Fprintf(w, "data: %s\n\n", raw)
	if f, ok := w.(stdhttp.Flusher); ok {
		f.Flush()
	}
}

func strVal(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}

func boolVal(v *bool) bool {
	return v != nil && *v
}

func uuids(in []apigen.UID) []uuid.UUID {
	out := make([]uuid.UUID, 0, len(in))
	for _, v := range in {
		out = append(out, uuid.UUID(v))
	}
	return out
}

func uuidPtr(in *openapi_types.UUID) *uuid.UUID {
	if in == nil {
		return nil
	}
	v := uuid.UUID(*in)
	return &v
}

func requestClientIP(r *stdhttp.Request) *netip.Addr {
	xff := r.Header.Get("X-Forwarded-For")
	if xff != "" {
		for _, p := range strings.Split(xff, ",") {
			p = strings.TrimSpace(p)
			if p != "" {
				if addr, err := netip.ParseAddr(p); err == nil {
					return &addr
				}
			}
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	if addr, err := netip.ParseAddr(host); err == nil {
		return &addr
	}
	return nil
}

func requestUserAgent(r *stdhttp.Request) *string {
	ua := strings.TrimSpace(r.Header.Get("User-Agent"))
	if ua == "" {
		return nil
	}
	return &ua
}
