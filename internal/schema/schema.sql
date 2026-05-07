CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS users (
  uid           UUID         PRIMARY KEY,
  username      TEXT         NOT NULL UNIQUE,
  email         CITEXT       NOT NULL UNIQUE,
  password_hash TEXT         NOT NULL,
  role          TEXT         NOT NULL CHECK (role IN ('user','admin')),
  disabled      BOOLEAN      NOT NULL DEFAULT FALSE,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS ai_model_groups (
  uid             UUID         PRIMARY KEY,
  slug            TEXT         NOT NULL,
  label           TEXT         NOT NULL,
  role            TEXT         NOT NULL DEFAULT '',
  color           TEXT         NOT NULL DEFAULT '',
  free            BOOLEAN      NOT NULL DEFAULT FALSE,
  position        INTEGER      NOT NULL DEFAULT 0,
  api_key_env_var TEXT         NOT NULL DEFAULT '',
  deleted_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);
-- Existing deployments: tables created before soft-delete lacked deleted_at; IF NOT EXISTS skips CREATE TABLE.
ALTER TABLE ai_model_groups ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
-- Partial indexes may reference free with integer literals (e.g. free = 1) under any index name;
-- indkey often omits free when free appears only in WHERE. Drop all partial indexes on this table
-- before ALTER TYPE or PostgreSQL errors with "operator does not exist: boolean = integer".
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch, ic.relname AS inm
    FROM pg_index i
    JOIN pg_class tbl ON tbl.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = tbl.relnamespace
    JOIN pg_class ic ON ic.oid = i.indexrelid
    WHERE n.nspname = 'public' AND tbl.relname = 'ai_model_groups'
      AND NOT i.indisprimary
      AND i.indpred IS NOT NULL
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS %I.%I', r.sch, r.inm);
  END LOOP;
END $$;
-- Older schemas used integer flags; partial indexes require boolean predicates.
-- Drop legacy CHECKs like (free = 0) before casting or they become (boolean = integer).
DO $$
DECLARE
  dt text;
  r record;
BEGIN
  SELECT c.data_type INTO dt
  FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.table_name = 'ai_model_groups' AND c.column_name = 'free'
  LIMIT 1;
  IF dt IN ('smallint', 'integer', 'bigint', 'numeric', 'real', 'double precision') THEN
    FOR r IN
      SELECT c.conname
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public' AND t.relname = 'ai_model_groups'
        AND c.contype = 'c'
        AND EXISTS (
          SELECT 1
          FROM unnest(c.conkey) AS ck(attnum)
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ck.attnum AND NOT a.attisdropped
          WHERE a.attname = 'free'
        )
    LOOP
      EXECUTE format('ALTER TABLE ai_model_groups DROP CONSTRAINT %I', r.conname);
    END LOOP;
    ALTER TABLE ai_model_groups ALTER COLUMN free DROP DEFAULT;
    IF dt IN ('smallint', 'integer', 'bigint') THEN
      ALTER TABLE ai_model_groups ALTER COLUMN free TYPE boolean USING (COALESCE(free::bigint, 0) <> 0);
    ELSE
      ALTER TABLE ai_model_groups ALTER COLUMN free TYPE boolean USING (COALESCE(free::numeric, 0) <> 0);
    END IF;
    ALTER TABLE ai_model_groups ALTER COLUMN free SET DEFAULT FALSE;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_groups_slug_active
  ON ai_model_groups(slug) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ai_groups_free_position
  ON ai_model_groups(position) WHERE deleted_at IS NULL AND free;
DROP TRIGGER IF EXISTS trg_ai_groups_updated_at ON ai_model_groups;
CREATE TRIGGER trg_ai_groups_updated_at BEFORE UPDATE ON ai_model_groups
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS ai_model_variants (
  uid                 UUID         PRIMARY KEY,
  group_uid           UUID         NOT NULL REFERENCES ai_model_groups(uid) ON DELETE CASCADE,
  slug                TEXT         NOT NULL,
  provider_model_id   TEXT         NOT NULL,
  label               TEXT         NOT NULL DEFAULT '',
  is_default          BOOLEAN      NOT NULL DEFAULT FALSE,
  position            INTEGER      NOT NULL DEFAULT 0,
  deleted_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
);
-- IF NOT EXISTS skipped CREATE: legacy tables may use group_id or omit group_uid entirely.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ai_model_variants' AND column_name = 'group_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ai_model_variants' AND column_name = 'group_uid'
  ) THEN
    ALTER TABLE ai_model_variants RENAME COLUMN group_id TO group_uid;
  END IF;
END $$;
ALTER TABLE ai_model_variants ADD COLUMN IF NOT EXISTS group_uid UUID REFERENCES ai_model_groups(uid) ON DELETE CASCADE;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ai_model_variants' AND column_name = 'group_uid'
  ) AND NOT EXISTS (SELECT 1 FROM ai_model_variants WHERE group_uid IS NULL LIMIT 1) THEN
    ALTER TABLE ai_model_variants ALTER COLUMN group_uid SET NOT NULL;
  END IF;
END $$;
ALTER TABLE ai_model_variants ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Existing deployments: add column and backfill before enforcing semantics.
ALTER TABLE ai_model_variants ADD COLUMN IF NOT EXISTS provider_model_id TEXT NOT NULL DEFAULT '';
UPDATE ai_model_variants SET provider_model_id = slug WHERE provider_model_id = '';
UPDATE ai_model_variants SET provider_model_id = 'qwen2.5:7b-instruct' WHERE slug = 'qwen2-5-7b-instruct';
ALTER TABLE ai_model_variants ALTER COLUMN provider_model_id DROP DEFAULT;
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch, ic.relname AS inm
    FROM pg_index i
    JOIN pg_class tbl ON tbl.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = tbl.relnamespace
    JOIN pg_class ic ON ic.oid = i.indexrelid
    WHERE n.nspname = 'public' AND tbl.relname = 'ai_model_variants'
      AND NOT i.indisprimary
      AND i.indpred IS NOT NULL
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS %I.%I', r.sch, r.inm);
  END LOOP;
END $$;
DO $$
DECLARE
  dt text;
  r record;
BEGIN
  SELECT c.data_type INTO dt
  FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.table_name = 'ai_model_variants' AND c.column_name = 'is_default'
  LIMIT 1;
  IF dt IN ('smallint', 'integer', 'bigint', 'numeric', 'real', 'double precision') THEN
    FOR r IN
      SELECT c.conname
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public' AND t.relname = 'ai_model_variants'
        AND c.contype = 'c'
        AND EXISTS (
          SELECT 1
          FROM unnest(c.conkey) AS ck(attnum)
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ck.attnum AND NOT a.attisdropped
          WHERE a.attname = 'is_default'
        )
    LOOP
      EXECUTE format('ALTER TABLE ai_model_variants DROP CONSTRAINT %I', r.conname);
    END LOOP;
    ALTER TABLE ai_model_variants ALTER COLUMN is_default DROP DEFAULT;
    IF dt IN ('smallint', 'integer', 'bigint') THEN
      ALTER TABLE ai_model_variants ALTER COLUMN is_default TYPE boolean USING (COALESCE(is_default::bigint, 0) <> 0);
    ELSE
      ALTER TABLE ai_model_variants ALTER COLUMN is_default TYPE boolean USING (COALESCE(is_default::numeric, 0) <> 0);
    END IF;
    ALTER TABLE ai_model_variants ALTER COLUMN is_default SET DEFAULT FALSE;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_variants_slug_active
  ON ai_model_variants(group_uid, slug) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_variants_default_per_group_active
  ON ai_model_variants(group_uid) WHERE deleted_at IS NULL AND is_default;
DROP TRIGGER IF EXISTS trg_ai_variants_updated_at ON ai_model_variants;
CREATE TRIGGER trg_ai_variants_updated_at BEFORE UPDATE ON ai_model_variants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS ai_chat_logs (
  uid                   UUID         PRIMARY KEY,
  user_uid              UUID         REFERENCES users(uid)             ON DELETE SET NULL,
  group_uid             UUID         REFERENCES ai_model_groups(uid)   ON DELETE SET NULL,
  variant_uid           UUID         REFERENCES ai_model_variants(uid) ON DELETE SET NULL,
  message               TEXT         NOT NULL,
  reply                 TEXT         NOT NULL,
  user_message_uid      UUID         NOT NULL,
  assistant_message_uid UUID         NOT NULL,
  client_ip             INET,
  user_agent            TEXT,
  editor_mode           TEXT         NOT NULL CHECK (editor_mode IN ('note','media','short','play','film')),
  note_context          JSONB,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT now()
);
-- IF NOT EXISTS skipped CREATE: ensure columns referenced by indexes exist.
ALTER TABLE ai_chat_logs ADD COLUMN IF NOT EXISTS user_uid UUID REFERENCES users(uid) ON DELETE SET NULL;
ALTER TABLE ai_chat_logs ADD COLUMN IF NOT EXISTS group_uid UUID REFERENCES ai_model_groups(uid) ON DELETE SET NULL;
ALTER TABLE ai_chat_logs ADD COLUMN IF NOT EXISTS variant_uid UUID REFERENCES ai_model_variants(uid) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_ai_chat_logs_created       ON ai_chat_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_chat_logs_user_created  ON ai_chat_logs(user_uid, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_chat_logs_group_created ON ai_chat_logs(group_uid, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_chat_logs_variant       ON ai_chat_logs(variant_uid);
CREATE INDEX IF NOT EXISTS idx_ai_chat_logs_message_trgm  ON ai_chat_logs USING gin (message gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_ai_chat_logs_reply_trgm    ON ai_chat_logs USING gin (reply   gin_trgm_ops);

CREATE TABLE IF NOT EXISTS user_ui_preferences (
  user_uid    UUID         PRIMARY KEY REFERENCES users(uid) ON DELETE CASCADE,
  data        JSONB        NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_user_ui_prefs_updated_at ON user_ui_preferences;
CREATE TRIGGER trg_user_ui_prefs_updated_at BEFORE UPDATE ON user_ui_preferences
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
