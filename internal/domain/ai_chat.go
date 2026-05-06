package domain

import "encoding/json"

type AIChatConversationMessage struct {
	ID           string     `json:"id"`
	Role         AIChatRole `json:"role"`
	Text         string     `json:"text"`
	Model        string     `json:"model"`
	ModelVariant string     `json:"modelVariant"`
}

type AIChatNoteContext struct {
	ConversationHistory []AIChatConversationMessage `json:"conversationHistory"`
	WorkfieldHTML       string                      `json:"workfieldHtml"`
}

type AIChatLogColumnSettings map[AIChatLogColumnKey]bool

func NormalizeEditorMode(raw string) EditorMode {
	if raw == "" {
		return EditorModeFilm
	}
	mode := EditorMode(raw)
	if !mode.IsValid() {
		return ""
	}
	return mode
}

func ValidJSONOrNil(raw json.RawMessage) json.RawMessage {
	if len(raw) == 0 || !json.Valid(raw) {
		return nil
	}
	return raw
}
