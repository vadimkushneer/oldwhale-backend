package service

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	dbgen "github.com/oldwhale/backend/internal/db/generated"
	"github.com/oldwhale/backend/internal/domain"
)

var ErrPrefsTooLarge = errors.New("preferences payload too large")

const maxUIPrefsJSONBytes = 64 * 1024

type AdminUIService struct {
	q dbgen.Querier
}

func NewAdminUIService(q dbgen.Querier) *AdminUIService {
	return &AdminUIService{q: q}
}

func (s *AdminUIService) GetForUser(ctx context.Context, userUID uuid.UUID) (domain.UserUIPreferences, error) {
	row, err := s.q.GetUserUIPreferences(ctx, userUID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.UserUIPreferences{UserUID: userUID, Data: []byte(`{}`)}, nil
		}
		return domain.UserUIPreferences{}, err
	}
	return dbUIPrefsToDomain(row), nil
}

func (s *AdminUIService) MergeAIChatLogTableColumns(ctx context.Context, userUID uuid.UUID, columns map[string]bool) (domain.UserUIPreferences, error) {
	current, err := s.GetForUser(ctx, userUID)
	if err != nil {
		return domain.UserUIPreferences{}, err
	}
	raw := current.Data
	if len(raw) == 0 {
		raw = []byte(`{}`)
	}
	var root map[string]any
	if err := json.Unmarshal(raw, &root); err != nil {
		root = map[string]any{}
	}
	table, _ := root["aiChatLogTable"].(map[string]any)
	if table == nil {
		table = map[string]any{}
	}
	existing, _ := table["columns"].(map[string]any)
	if existing == nil {
		existing = map[string]any{}
	}
	for k, b := range columns {
		existing[k] = b
	}
	table["columns"] = existing
	table["updated_at"] = time.Now().UTC().Format(time.RFC3339Nano)
	root["aiChatLogTable"] = table
	out, err := json.Marshal(root)
	if err != nil {
		return domain.UserUIPreferences{}, err
	}
	if len(out) > maxUIPrefsJSONBytes {
		return domain.UserUIPreferences{}, ErrPrefsTooLarge
	}
	row, err := s.q.UpsertUserUIPreferences(ctx, dbgen.UpsertUserUIPreferencesParams{UserUid: userUID, Data: out})
	if err != nil {
		return domain.UserUIPreferences{}, err
	}
	return dbUIPrefsToDomain(row), nil
}
