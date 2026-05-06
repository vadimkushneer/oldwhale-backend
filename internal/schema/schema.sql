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
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_groups_slug_active
  ON ai_model_groups(slug) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ai_groups_free_position
  ON ai_model_groups(position) WHERE deleted_at IS NULL AND free;
DROP TRIGGER IF EXISTS trg_ai_groups_updated_at ON ai_model_groups;
CREATE TRIGGER trg_ai_groups_updated_at BEFORE UPDATE ON ai_model_groups
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS ai_model_variants (
  uid         UUID         PRIMARY KEY,
  group_uid   UUID         NOT NULL REFERENCES ai_model_groups(uid) ON DELETE CASCADE,
  slug        TEXT         NOT NULL,
  label       TEXT         NOT NULL DEFAULT '',
  is_default  BOOLEAN      NOT NULL DEFAULT FALSE,
  position    INTEGER      NOT NULL DEFAULT 0,
  deleted_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
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
