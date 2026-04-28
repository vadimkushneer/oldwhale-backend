package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/oldwhale/backend/internal/db"
)

func (s *Server) AdminMeUISettingsGet(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		jsonErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	uid, ok := UserID(r)
	if !ok {
		jsonErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	u, err := db.GetUserByID(s.DB, uid)
	if err != nil || u.Disabled || u.Role != "admin" {
		jsonErr(w, http.StatusForbidden, "forbidden")
		return
	}
	raw, rowUpdated, err := db.GetUserUIPreferences(s.DB, uid)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, "db error")
		return
	}
	jsonOK(w, adminUISettingsFromRaw(raw, rowUpdated))
}

type adminUIPutReq struct {
	AIChatLogTable struct {
		Columns map[string]bool `json:"columns"`
	} `json:"aiChatLogTable"`
}

func (s *Server) AdminMeUISettingsPut(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		jsonErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	uid, ok := UserID(r)
	if !ok {
		jsonErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	u, err := db.GetUserByID(s.DB, uid)
	if err != nil || u.Disabled || u.Role != "admin" {
		jsonErr(w, http.StatusForbidden, "forbidden")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxUIPrefsRequestBytes)
	var in adminUIPutReq
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if in.AIChatLogTable.Columns == nil {
		jsonErr(w, http.StatusBadRequest, "aiChatLogTable.columns required")
		return
	}
	if _, err := db.MergeAIChatLogTableColumns(s.DB, uid, in.AIChatLogTable.Columns); err != nil {
		if errors.Is(err, db.ErrPrefsTooLarge) {
			jsonErr(w, http.StatusRequestEntityTooLarge, "preferences too large")
			return
		}
		jsonErr(w, http.StatusInternalServerError, "db error")
		return
	}
	raw, rowUpdated, err := db.GetUserUIPreferences(s.DB, uid)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, "db error")
		return
	}
	jsonOK(w, adminUISettingsFromRaw(raw, rowUpdated))
}

const maxUIPrefsRequestBytes = 64 * 1024

func adminUISettingsFromRaw(raw []byte, rowUpdated time.Time) map[string]any {
	out := map[string]any{
		"aiChatLogTable": map[string]any{
			"columns":    map[string]any{},
			"updated_at": nil,
		},
	}
	var root map[string]any
	if err := json.Unmarshal(raw, &root); err != nil {
		return out
	}
	t, ok := root["aiChatLogTable"].(map[string]any)
	if !ok || t == nil {
		return out
	}
	table := map[string]any{"columns": map[string]any{}, "updated_at": nil}
	if c, ok := t["columns"].(map[string]any); ok && c != nil {
		table["columns"] = c
	}
	if ts, ok := t["updated_at"].(string); ok && ts != "" {
		table["updated_at"] = ts
	} else if !rowUpdated.IsZero() {
		table["updated_at"] = rowUpdated.UTC().Format(time.RFC3339Nano)
	}
	out["aiChatLogTable"] = table
	return out
}
