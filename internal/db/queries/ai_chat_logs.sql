-- name: InsertAIChatLog :one
INSERT INTO ai_chat_logs (
  uid,
  user_uid,
  group_uid,
  variant_uid,
  message,
  reply,
  user_message_uid,
  assistant_message_uid,
  client_ip,
  user_agent,
  editor_mode,
  note_context
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
)
RETURNING *;

-- name: GetAIChatLogByUID :one
SELECT * FROM ai_chat_logs
WHERE uid = $1;
