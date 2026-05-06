package domain

import (
	"encoding/json"
	"time"
)

type UserUIPreferences struct {
	UserUID   UID
	Data      json.RawMessage
	CreatedAt time.Time
	UpdatedAt time.Time
}
