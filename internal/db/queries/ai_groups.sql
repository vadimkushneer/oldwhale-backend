-- name: CountAIGroups :one
SELECT COUNT(*) FROM ai_model_groups;

-- name: CreateAIGroup :one
INSERT INTO ai_model_groups (
  uid, slug, label, role, color, free, position, api_key_env_var
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8
)
RETURNING *;

-- name: GetAIGroupByUID :one
SELECT * FROM ai_model_groups
WHERE uid = $1 AND deleted_at IS NULL;

-- name: GetAIGroupByUIDIncludingDeleted :one
SELECT * FROM ai_model_groups
WHERE uid = $1;

-- name: GetAIGroupBySlug :one
SELECT * FROM ai_model_groups
WHERE slug = $1 AND deleted_at IS NULL;

-- name: ListAIGroupsAdmin :many
SELECT * FROM ai_model_groups
WHERE deleted_at IS NULL
ORDER BY position, uid;

-- name: ListAIGroupsAdminIncludingDeleted :many
SELECT * FROM ai_model_groups
ORDER BY deleted_at NULLS FIRST, position, uid;

-- name: ListPublicCatalogJoined :many
SELECT
  g.uid AS group_model_uid,
  g.slug AS group_model_slug,
  g.label AS group_model_label,
  g.role AS group_model_role,
  g.color AS group_model_color,
  g.free AS group_model_free,
  g.position AS group_model_position,
  g.api_key_env_var AS group_model_api_key_env_var,
  g.deleted_at AS group_model_deleted_at,
  g.created_at AS group_model_created_at,
  g.updated_at AS group_model_updated_at,
  v.uid AS variant_model_uid,
  v.group_uid AS variant_model_group_uid,
  v.slug AS variant_model_slug,
  v.provider_model_id AS variant_model_provider_model_id,
  v.label AS variant_model_label,
  v.is_default AS variant_model_is_default,
  v.position AS variant_model_position,
  v.deleted_at AS variant_model_deleted_at,
  v.created_at AS variant_model_created_at,
  v.updated_at AS variant_model_updated_at
FROM ai_model_groups g
LEFT JOIN ai_model_variants v
  ON v.group_uid = g.uid
 AND v.deleted_at IS NULL
WHERE g.deleted_at IS NULL
  AND (sqlc.arg(include_paid)::boolean OR g.free)
ORDER BY g.position, g.uid, v.position, v.uid;

-- name: PatchAIGroup :one
UPDATE ai_model_groups
SET
  slug = COALESCE(sqlc.narg(slug), slug),
  label = COALESCE(sqlc.narg(label), label),
  role = COALESCE(sqlc.narg(role), role),
  color = COALESCE(sqlc.narg(color), color),
  free = COALESCE(sqlc.narg(free), free),
  position = COALESCE(sqlc.narg(position), position),
  api_key_env_var = COALESCE(sqlc.narg(api_key_env_var), api_key_env_var)
WHERE uid = sqlc.arg(uid)
  AND deleted_at IS NULL
RETURNING *;

-- name: SoftDeleteAIGroup :one
UPDATE ai_model_groups
SET deleted_at = now()
WHERE uid = $1
  AND deleted_at IS NULL
RETURNING *;

-- name: ReorderAIGroups :exec
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
UPDATE ai_model_groups g
SET position = ordered.position
FROM ordered
WHERE g.uid = ordered.uid
  AND g.deleted_at IS NULL;
