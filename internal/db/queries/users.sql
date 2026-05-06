-- name: CountUsers :one
SELECT COUNT(*) FROM users;

-- name: CreateUser :one
INSERT INTO users (
  uid, username, email, password_hash, role, disabled
) VALUES (
  $1, $2, $3, $4, $5, $6
)
RETURNING *;

-- name: GetUserByUID :one
SELECT * FROM users
WHERE uid = $1;

-- name: GetUserByUsername :one
SELECT * FROM users
WHERE username = $1;

-- name: ListUsersPaged :many
SELECT * FROM users
ORDER BY created_at DESC, uid DESC
LIMIT $1 OFFSET $2;

-- name: UpdateUserRole :one
UPDATE users
SET role = $2
WHERE uid = $1
RETURNING *;

-- name: UpdateUserDisabled :one
UPDATE users
SET disabled = $2
WHERE uid = $1
RETURNING *;

-- name: RecordUserLogin :one
UPDATE users
SET last_login_at = now()
WHERE uid = $1
RETURNING *;

-- name: DeleteUser :execrows
DELETE FROM users
WHERE uid = $1;

-- name: UpdateUserPasswordHash :one
UPDATE users
SET password_hash = $2, updated_at = now()
WHERE uid = $1
RETURNING *;
