package service

import (
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	dbgen "github.com/oldwhale/backend/internal/db/generated"
	"github.com/oldwhale/backend/internal/domain"
)

func dbUserToDomain(u dbgen.User) domain.User {
	return domain.User{
		Meta:         domain.Meta{UID: u.Uid, CreatedAt: u.CreatedAt, UpdatedAt: u.UpdatedAt},
		Username:     u.Username,
		Email:        u.Email,
		PasswordHash: u.PasswordHash,
		Role:         domain.UserRole(u.Role),
		Disabled:     u.Disabled,
		LastLoginAt:  timePtr(u.LastLoginAt),
	}
}

func dbGroupToDomain(g dbgen.AiModelGroup) domain.AIModelGroup {
	return domain.AIModelGroup{
		Meta:         domain.Meta{UID: g.Uid, CreatedAt: g.CreatedAt, UpdatedAt: g.UpdatedAt},
		Slug:         g.Slug,
		Label:        g.Label,
		Role:         g.Role,
		Color:        g.Color,
		Free:         g.Free,
		Position:     int(g.Position),
		APIKeyEnvVar: g.ApiKeyEnvVar,
		DeletedAt:    timePtr(g.DeletedAt),
	}
}

func dbVariantToDomain(v dbgen.AiModelVariant) domain.AIModelVariant {
	return domain.AIModelVariant{
		Meta:      domain.Meta{UID: v.Uid, CreatedAt: v.CreatedAt, UpdatedAt: v.UpdatedAt},
		GroupUID:  v.GroupUid,
		Slug:      v.Slug,
		Label:     v.Label,
		IsDefault: v.IsDefault,
		Position:  int(v.Position),
		DeletedAt: timePtr(v.DeletedAt),
	}
}

func dbUIPrefsToDomain(p dbgen.UserUiPreference) domain.UserUIPreferences {
	return domain.UserUIPreferences{
		UserUID:   p.UserUid,
		Data:      p.Data,
		CreatedAt: p.CreatedAt,
		UpdatedAt: p.UpdatedAt,
	}
}

func uuidPtrToPg(v *domain.UID) pgtype.UUID {
	if v == nil {
		return pgtype.UUID{}
	}
	return pgtype.UUID{Bytes: uuid.UUID(*v), Valid: true}
}

func pgUUIDPtr(v pgtype.UUID) *domain.UID {
	if !v.Valid {
		return nil
	}
	u := domain.UID(v.Bytes)
	return &u
}

func timePtr(v pgtype.Timestamptz) *time.Time {
	if !v.Valid {
		return nil
	}
	t := v.Time
	return &t
}
