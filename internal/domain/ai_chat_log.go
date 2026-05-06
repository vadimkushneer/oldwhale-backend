package domain

import (
	"encoding/json"
	"net/netip"
	"time"
)

type AIChatLog struct {
	UID                 UID
	CreatedAt           time.Time
	UserUID             *UID
	GroupUID            *UID
	VariantUID          *UID
	Message             string
	Reply               string
	UserMessageUID      UID
	AssistantMessageUID UID
	ClientIP            *netip.Addr
	UserAgent           *string
	EditorMode          EditorMode
	NoteContext         json.RawMessage
}

type AIChatLogUserRef struct {
	UID      UID
	Username string
	Email    string
}

type AIChatLogGroupRef struct {
	UID       UID
	Slug      string
	Label     string
	DeletedAt *time.Time
}

type AIChatLogVariantRef struct {
	UID       UID
	Slug      string
	Label     string
	DeletedAt *time.Time
}

type AIChatLogItem struct {
	Log     AIChatLog
	User    *AIChatLogUserRef
	Group   *AIChatLogGroupRef
	Variant *AIChatLogVariantRef
}
