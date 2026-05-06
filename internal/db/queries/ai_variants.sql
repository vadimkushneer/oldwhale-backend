-- name: CreateAIVariant :one
INSERT INTO ai_model_variants (
  uid, group_uid, slug, provider_model_id, label, is_default, position
) VALUES (
  $1, $2, $3, $4, $5, $6, $7
)
RETURNING *;

-- name: GetAIVariantByUID :one
SELECT * FROM ai_model_variants
WHERE uid = $1 AND deleted_at IS NULL;

-- name: GetAIVariantByUIDIncludingDeleted :one
SELECT * FROM ai_model_variants
WHERE uid = $1;

-- name: ListAIVariantsByGroup :many
SELECT * FROM ai_model_variants
WHERE group_uid = $1
  AND deleted_at IS NULL
ORDER BY position, uid;

-- name: ListAIVariantsByGroupIncludingDeleted :many
SELECT * FROM ai_model_variants
WHERE group_uid = $1
ORDER BY deleted_at NULLS FIRST, position, uid;

-- name: UpsertAIVariantImport :one
INSERT INTO ai_model_variants (
  uid, group_uid, slug, provider_model_id, label, is_default, position
) VALUES (
  $1, $2, $3, $4, $5, $6, $7
)
ON CONFLICT (group_uid, slug) WHERE deleted_at IS NULL
DO UPDATE SET
  label = EXCLUDED.label,
  position = EXCLUDED.position,
  provider_model_id = EXCLUDED.provider_model_id
RETURNING *;

-- name: PatchAIVariant :one
UPDATE ai_model_variants
SET
  slug = COALESCE(sqlc.narg(slug), slug),
  provider_model_id = COALESCE(sqlc.narg(provider_model_id), provider_model_id),
  label = COALESCE(sqlc.narg(label), label),
  is_default = COALESCE(sqlc.narg(is_default), is_default),
  position = COALESCE(sqlc.narg(position), position)
WHERE uid = sqlc.arg(uid)
  AND deleted_at IS NULL
RETURNING *;

-- name: SoftDeleteAIVariant :one
UPDATE ai_model_variants
SET deleted_at = now()
WHERE uid = $1
  AND deleted_at IS NULL
RETURNING *;

-- name: ReorderAIVariants :exec
WITH input AS (
  SELECT sqlc.arg(uids)::uuid[] AS uids
),
ordered AS (
  SELECT unnested.uid, subscripts.position - 1 AS position
  FROM input,
       generate_subscripts(input.uids, 1) AS subscripts(position),
       unnest(input.uids) WITH ORDINALITY AS unnested(uid, ord)
  WHERE unnested.ord = subscripts.position
)
UPDATE ai_model_variants v
SET position = ordered.position
FROM ordered
WHERE v.uid = ordered.uid
  AND v.group_uid = sqlc.arg(group_uid)
  AND v.deleted_at IS NULL;

-- name: SetDefaultAIVariant :execrows
UPDATE ai_model_variants
SET is_default = (uid = sqlc.arg(uid))
WHERE group_uid = sqlc.arg(group_uid)
  AND deleted_at IS NULL;
