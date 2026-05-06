-- name: GetUserUIPreferences :one
SELECT * FROM user_ui_preferences
WHERE user_uid = $1;

-- name: UpsertUserUIPreferences :one
INSERT INTO user_ui_preferences (
  user_uid, data
) VALUES (
  $1, $2
)
ON CONFLICT (user_uid)
DO UPDATE SET data = EXCLUDED.data
RETURNING *;
