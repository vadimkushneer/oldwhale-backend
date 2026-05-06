package domain

type UserRole string

const (
	RoleUser  UserRole = "user"
	RoleAdmin UserRole = "admin"
)

func (r UserRole) IsValid() bool {
	switch r {
	case RoleUser, RoleAdmin:
		return true
	default:
		return false
	}
}

type EditorMode string

const (
	EditorModeNote  EditorMode = "note"
	EditorModeMedia EditorMode = "media"
	EditorModeShort EditorMode = "short"
	EditorModePlay  EditorMode = "play"
	EditorModeFilm  EditorMode = "film"
)

func (m EditorMode) IsValid() bool {
	switch m {
	case EditorModeNote, EditorModeMedia, EditorModeShort, EditorModePlay, EditorModeFilm:
		return true
	default:
		return false
	}
}

type AIChatRole string

const (
	AIChatRoleUser AIChatRole = "user"
	AIChatRoleAI   AIChatRole = "ai"
	AIChatRoleSys  AIChatRole = "sys"
)

func (r AIChatRole) IsValid() bool {
	switch r {
	case AIChatRoleUser, AIChatRoleAI, AIChatRoleSys:
		return true
	default:
		return false
	}
}

type AIChatLogColumnKey string

const (
	AIChatLogColumnUID         AIChatLogColumnKey = "uid"
	AIChatLogColumnTime        AIChatLogColumnKey = "time"
	AIChatLogColumnUser        AIChatLogColumnKey = "user"
	AIChatLogColumnMessage     AIChatLogColumnKey = "message"
	AIChatLogColumnReply       AIChatLogColumnKey = "reply"
	AIChatLogColumnModel       AIChatLogColumnKey = "model"
	AIChatLogColumnMessageIDs  AIChatLogColumnKey = "message_ids"
	AIChatLogColumnIPUA        AIChatLogColumnKey = "ip_ua"
	AIChatLogColumnEditorMode  AIChatLogColumnKey = "editor_mode"
	AIChatLogColumnNoteContext AIChatLogColumnKey = "note_context"
)

func (k AIChatLogColumnKey) IsValid() bool {
	switch k {
	case AIChatLogColumnUID, AIChatLogColumnTime, AIChatLogColumnUser, AIChatLogColumnMessage,
		AIChatLogColumnReply, AIChatLogColumnModel, AIChatLogColumnMessageIDs, AIChatLogColumnIPUA,
		AIChatLogColumnEditorMode, AIChatLogColumnNoteContext:
		return true
	default:
		return false
	}
}
