package db

import (
	"database/sql"
	"encoding/json"
	"errors"
	"time"
)

// ErrPrefsTooLarge is returned when merged JSON exceeds maxUIPrefsJSONBytes.
var ErrPrefsTooLarge = errors.New("preferences payload too large")

const maxUIPrefsJSONBytes = 64 * 1024

func (d *Database) migrateUserUIPreferences() error {
	_, err := d.Exec(`
CREATE TABLE IF NOT EXISTS user_ui_preferences (
	user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
	data JSONB NOT NULL DEFAULT '{}'::jsonb,
	updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`)
	return err
}

// GetUserUIPreferences returns the JSON blob for a user, or empty object if none.
func GetUserUIPreferences(d *Database, userID int64) ([]byte, time.Time, error) {
	var raw []byte
	var updatedAt time.Time
	err := d.QueryRow(
		`SELECT data, updated_at FROM user_ui_preferences WHERE user_id = $1`,
		userID,
	).Scan(&raw, &updatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return []byte(`{}`), time.Time{}, nil
	}
	if err != nil {
		return nil, time.Time{}, err
	}
	if len(raw) == 0 {
		return []byte(`{}`), updatedAt, nil
	}
	return raw, updatedAt, nil
}

// MergeAIChatLogTableColumns merges columns into data.aiChatLogTable and upserts the row.
func MergeAIChatLogTableColumns(d *Database, userID int64, columns map[string]bool) ([]byte, error) {
	raw, _, err := GetUserUIPreferences(d, userID)
	if err != nil {
		return nil, err
	}
	var root map[string]any
	if err := json.Unmarshal(raw, &root); err != nil {
		root = map[string]any{}
	}
	var table map[string]any
	if v, ok := root["aiChatLogTable"].(map[string]any); ok && v != nil {
		table = v
	} else {
		table = map[string]any{}
	}
	var existing map[string]any
	if v, ok := table["columns"].(map[string]any); ok && v != nil {
		existing = v
	} else {
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
		return nil, err
	}
	if len(out) > maxUIPrefsJSONBytes {
		return nil, ErrPrefsTooLarge
	}
	_, err = d.Exec(`
INSERT INTO user_ui_preferences (user_id, data, updated_at)
VALUES ($1, $2::jsonb, now())
ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
		userID, out,
	)
	if err != nil {
		return nil, err
	}
	return out, nil
}
