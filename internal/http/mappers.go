package http

import (
	"encoding/json"

	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/oldwhale/backend/internal/domain"
	apigen "github.com/oldwhale/backend/internal/http/generated"
	"github.com/oldwhale/backend/internal/service"
)

func DomainToAPIUser(u domain.User) apigen.User {
	return apigen.User{
		Uid:         openapi_types.UUID(u.UID),
		Username:    u.Username,
		Email:       openapi_types.Email(u.Email),
		Role:        apigen.UserRole(u.Role),
		Disabled:    u.Disabled,
		LastLoginAt: u.LastLoginAt,
		CreatedAt:   u.CreatedAt,
		UpdatedAt:   u.UpdatedAt,
	}
}

func DomainToAPIVariantAdmin(v domain.AIModelVariant) apigen.AiVariantAdmin {
	return apigen.AiVariantAdmin{
		Uid:       openapi_types.UUID(v.UID),
		GroupUid:  openapi_types.UUID(v.GroupUID),
		Slug:      v.Slug,
		Label:     v.Label,
		IsDefault: v.IsDefault,
		Position:  v.Position,
		DeletedAt: v.DeletedAt,
		CreatedAt: v.CreatedAt,
		UpdatedAt: v.UpdatedAt,
	}
}

func DomainToAPIVariantPublic(v domain.AIModelVariant) apigen.AiVariantPublic {
	return apigen.AiVariantPublic{
		Uid:       openapi_types.UUID(v.UID),
		Slug:      v.Slug,
		Label:     v.Label,
		IsDefault: v.IsDefault,
		CreatedAt: v.CreatedAt,
		UpdatedAt: v.UpdatedAt,
	}
}

func DomainToAPIGroupAdmin(view service.AdminGroupView) apigen.AiGroupAdmin {
	g := view.Group
	variants := make([]apigen.AiVariantAdmin, 0, len(g.Variants))
	for _, v := range g.Variants {
		variants = append(variants, DomainToAPIVariantAdmin(v))
	}
	return apigen.AiGroupAdmin{
		Uid:           openapi_types.UUID(g.UID),
		Slug:          g.Slug,
		Label:         g.Label,
		Role:          g.Role,
		Color:         g.Color,
		Free:          g.Free,
		Position:      g.Position,
		ApiKeyEnvVar:  g.APIKeyEnvVar,
		ApiKeyPresent: view.APIKeyPresent,
		DeletedAt:     g.DeletedAt,
		CreatedAt:     g.CreatedAt,
		UpdatedAt:     g.UpdatedAt,
		Variants:      variants,
	}
}

func DomainToAPIGroupPublic(g domain.AIModelGroup) apigen.AiGroupPublic {
	variants := make([]apigen.AiVariantPublic, 0, len(g.Variants))
	for _, v := range g.Variants {
		variants = append(variants, DomainToAPIVariantPublic(v))
	}
	return apigen.AiGroupPublic{
		Uid:       openapi_types.UUID(g.UID),
		Slug:      g.Slug,
		Label:     g.Label,
		Role:      g.Role,
		Color:     g.Color,
		Free:      g.Free,
		CreatedAt: g.CreatedAt,
		UpdatedAt: g.UpdatedAt,
		Variants:  variants,
	}
}

func DomainToAPIPublicCatalog(groups []domain.AIModelGroup, includePaid bool) apigen.AiCatalogPublicResponse {
	out := make([]apigen.AiGroupPublic, 0, len(groups))
	for _, g := range groups {
		if !includePaid && !g.Free {
			continue
		}
		out = append(out, DomainToAPIGroupPublic(g))
	}
	return apigen.AiCatalogPublicResponse{Groups: out}
}

func DomainToAPIChatLogItem(item domain.AIChatLogItem) apigen.AiChatLogItem {
	out := apigen.AiChatLogItem{
		Uid:                 openapi_types.UUID(item.Log.UID),
		CreatedAt:           item.Log.CreatedAt,
		UserMessageUid:      openapi_types.UUID(item.Log.UserMessageUID),
		AssistantMessageUid: openapi_types.UUID(item.Log.AssistantMessageUID),
		Message:             item.Log.Message,
		Reply:               item.Log.Reply,
		EditorMode:          apigen.EditorMode(item.Log.EditorMode),
		UserAgent:           item.Log.UserAgent,
	}
	if item.Log.UserUID != nil {
		v := openapi_types.UUID(*item.Log.UserUID)
		out.UserUid = &v
	}
	if item.Log.GroupUID != nil {
		v := openapi_types.UUID(*item.Log.GroupUID)
		out.GroupUid = &v
	}
	if item.Log.VariantUID != nil {
		v := openapi_types.UUID(*item.Log.VariantUID)
		out.VariantUid = &v
	}
	if item.Log.ClientIP != nil {
		s := item.Log.ClientIP.String()
		out.ClientIp = &s
	}
	if len(item.Log.NoteContext) > 0 {
		var parsed map[string]any
		if json.Unmarshal(item.Log.NoteContext, &parsed) == nil {
			out.NoteContext = &parsed
		}
	}
	if item.User != nil {
		out.User = &apigen.AiChatLogUser{
			Uid:      openapi_types.UUID(item.User.UID),
			Username: item.User.Username,
			Email:    item.User.Email,
		}
	}
	if item.Group != nil {
		out.Group = &apigen.AiGroupRefJoin{
			Uid:       openapi_types.UUID(item.Group.UID),
			Slug:      item.Group.Slug,
			Label:     item.Group.Label,
			DeletedAt: item.Group.DeletedAt,
		}
	}
	if item.Variant != nil {
		out.Variant = &apigen.AiVariantRefJoin{
			Uid:       openapi_types.UUID(item.Variant.UID),
			Slug:      item.Variant.Slug,
			Label:     item.Variant.Label,
			DeletedAt: item.Variant.DeletedAt,
		}
	}
	return out
}

func DomainToAPIUIPreferences(p domain.UserUIPreferences) apigen.AdminUiSettingsResponse {
	out := apigen.AdminUiSettingsResponse{
		AiChatLogTable: apigen.AiChatLogTableSettings{
			Columns:   map[string]bool{},
			UpdatedAt: nil,
		},
	}
	var root map[string]any
	if json.Unmarshal(p.Data, &root) != nil {
		return out
	}
	table, _ := root["aiChatLogTable"].(map[string]any)
	if table == nil {
		return out
	}
	if columns, ok := table["columns"].(map[string]any); ok {
		for k, v := range columns {
			if b, ok := v.(bool); ok {
				out.AiChatLogTable.Columns[k] = b
			}
		}
	}
	if ts, ok := table["updated_at"].(string); ok && ts != "" {
		// Keep existing UI payload timestamp parsing loose; the DB row timestamp is
		// still authoritative if this string ever stops parsing.
		if t, err := parseTime(ts); err == nil {
			out.AiChatLogTable.UpdatedAt = &t
		}
	} else if !p.UpdatedAt.IsZero() {
		out.AiChatLogTable.UpdatedAt = &p.UpdatedAt
	}
	return out
}

func parseTime(s string) (apigen.DateTime, error) {
	var t apigen.DateTime
	err := t.UnmarshalText([]byte(s))
	return t, err
}
