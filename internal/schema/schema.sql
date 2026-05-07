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

-- Existing foreign keys may point at legacy id/group_id columns. Drop them before
-- renaming or changing key column types; standard FKs are added back near the end.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch, t.relname AS tbl, c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname IN ('users', 'ai_model_groups', 'ai_model_variants', 'ai_chat_logs', 'user_ui_preferences')
      AND c.contype = 'f'
  LOOP
    EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT %I', r.sch, r.tbl, r.conname);
  END LOOP;
END $$;

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

DO $$
DECLARE
  dt text;
  r record;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'uid'
  ) THEN
    ALTER TABLE users RENAME COLUMN id TO uid;
  END IF;

  ALTER TABLE users ADD COLUMN IF NOT EXISTS uid UUID;
  SELECT c.data_type INTO dt
  FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.table_name = 'users' AND c.column_name = 'uid'
  LIMIT 1;
  IF dt <> 'uuid' THEN
    ALTER TABLE users ALTER COLUMN uid DROP DEFAULT;
    ALTER TABLE users ALTER COLUMN uid TYPE UUID USING (
      CASE
        WHEN uid::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN uid::text::uuid
        ELSE gen_random_uuid()
      END
    );
  END IF;
  UPDATE users SET uid = gen_random_uuid() WHERE uid IS NULL;
  ALTER TABLE users ALTER COLUMN uid SET DEFAULT gen_random_uuid();
  ALTER TABLE users ALTER COLUMN uid SET NOT NULL;

  ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT NOT NULL DEFAULT '';
  ALTER TABLE users ALTER COLUMN username SET DEFAULT '';
  UPDATE users SET username = uid::text WHERE username IS NULL OR username = '';
  ALTER TABLE users ALTER COLUMN username SET NOT NULL;

  ALTER TABLE users ADD COLUMN IF NOT EXISTS email CITEXT;
  UPDATE users
  SET email = (lower(uid::text) || '@legacy.local')::citext
  WHERE email IS NULL OR email::text = '';
  ALTER TABLE users ALTER COLUMN email SET DEFAULT '';
  ALTER TABLE users ALTER COLUMN email SET NOT NULL;

  ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT NOT NULL DEFAULT '';
  ALTER TABLE users ALTER COLUMN password_hash SET DEFAULT '';
  UPDATE users SET password_hash = '' WHERE password_hash IS NULL;
  ALTER TABLE users ALTER COLUMN password_hash SET NOT NULL;

  ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';
  ALTER TABLE users ALTER COLUMN role SET DEFAULT 'user';
  UPDATE users SET role = 'user' WHERE role IS NULL OR role NOT IN ('user','admin');
  ALTER TABLE users ALTER COLUMN role SET NOT NULL;

  ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled BOOLEAN NOT NULL DEFAULT FALSE;
  SELECT c.data_type INTO dt
  FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.table_name = 'users' AND c.column_name = 'disabled'
  LIMIT 1;
  IF dt IN ('smallint', 'integer', 'bigint', 'numeric', 'real', 'double precision', 'text', 'character varying', 'character') THEN
    FOR r IN
      SELECT c.conname
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public' AND t.relname = 'users'
        AND c.contype = 'c'
        AND EXISTS (
          SELECT 1
          FROM unnest(c.conkey) AS ck(attnum)
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ck.attnum AND NOT a.attisdropped
          WHERE a.attname = 'disabled'
        )
    LOOP
      EXECUTE format('ALTER TABLE users DROP CONSTRAINT %I', r.conname);
    END LOOP;
    ALTER TABLE users ALTER COLUMN disabled DROP DEFAULT;
    IF dt IN ('smallint', 'integer', 'bigint', 'numeric', 'real', 'double precision') THEN
      ALTER TABLE users ALTER COLUMN disabled TYPE boolean USING (COALESCE(disabled::numeric, 0) <> 0);
    ELSE
      ALTER TABLE users ALTER COLUMN disabled TYPE boolean USING (lower(COALESCE(disabled::text, '')) IN ('1','t','true','yes','y','on'));
    END IF;
  END IF;
  ALTER TABLE users ALTER COLUMN disabled SET DEFAULT FALSE;
  UPDATE users SET disabled = FALSE WHERE disabled IS NULL;
  ALTER TABLE users ALTER COLUMN disabled SET NOT NULL;

  ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
  UPDATE users SET created_at = now() WHERE created_at IS NULL;
  ALTER TABLE users ALTER COLUMN created_at SET DEFAULT now();
  ALTER TABLE users ALTER COLUMN created_at SET NOT NULL;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
  UPDATE users SET updated_at = now() WHERE updated_at IS NULL;
  ALTER TABLE users ALTER COLUMN updated_at SET DEFAULT now();
  ALTER TABLE users ALTER COLUMN updated_at SET NOT NULL;
END $$;

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

DO $$
DECLARE
  dt text;
  r record;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ai_model_groups' AND column_name = 'id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ai_model_groups' AND column_name = 'uid'
  ) THEN
    ALTER TABLE ai_model_groups RENAME COLUMN id TO uid;
  END IF;

  ALTER TABLE ai_model_groups ADD COLUMN IF NOT EXISTS uid UUID;
  SELECT c.data_type INTO dt
  FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.table_name = 'ai_model_groups' AND c.column_name = 'uid'
  LIMIT 1;
  IF dt <> 'uuid' THEN
    ALTER TABLE ai_model_groups ALTER COLUMN uid DROP DEFAULT;
    ALTER TABLE ai_model_groups ALTER COLUMN uid TYPE UUID USING (
      CASE
        WHEN uid::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN uid::text::uuid
        ELSE gen_random_uuid()
      END
    );
  END IF;
  UPDATE ai_model_groups SET uid = gen_random_uuid() WHERE uid IS NULL;
  ALTER TABLE ai_model_groups ALTER COLUMN uid SET DEFAULT gen_random_uuid();
  ALTER TABLE ai_model_groups ALTER COLUMN uid SET NOT NULL;

  ALTER TABLE ai_model_groups ADD COLUMN IF NOT EXISTS slug TEXT NOT NULL DEFAULT '';
  ALTER TABLE ai_model_groups ALTER COLUMN slug SET DEFAULT '';
  UPDATE ai_model_groups SET slug = uid::text WHERE slug IS NULL OR slug = '';
  ALTER TABLE ai_model_groups ALTER COLUMN slug SET NOT NULL;

  ALTER TABLE ai_model_groups ADD COLUMN IF NOT EXISTS label TEXT NOT NULL DEFAULT '';
  ALTER TABLE ai_model_groups ALTER COLUMN label SET DEFAULT '';
  UPDATE ai_model_groups SET label = slug WHERE label IS NULL OR label = '';
  ALTER TABLE ai_model_groups ALTER COLUMN label SET NOT NULL;

  ALTER TABLE ai_model_groups ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT '';
  ALTER TABLE ai_model_groups ALTER COLUMN role SET DEFAULT '';
  UPDATE ai_model_groups SET role = '' WHERE role IS NULL;
  ALTER TABLE ai_model_groups ALTER COLUMN role SET NOT NULL;

  ALTER TABLE ai_model_groups ADD COLUMN IF NOT EXISTS color TEXT NOT NULL DEFAULT '';
  ALTER TABLE ai_model_groups ALTER COLUMN color SET DEFAULT '';
  UPDATE ai_model_groups SET color = '' WHERE color IS NULL;
  ALTER TABLE ai_model_groups ALTER COLUMN color SET NOT NULL;

  ALTER TABLE ai_model_groups ADD COLUMN IF NOT EXISTS free BOOLEAN NOT NULL DEFAULT FALSE;
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
  SELECT c.data_type INTO dt
  FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.table_name = 'ai_model_groups' AND c.column_name = 'free'
  LIMIT 1;
  IF dt IN ('smallint', 'integer', 'bigint', 'numeric', 'real', 'double precision', 'text', 'character varying', 'character') THEN
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
    IF dt IN ('smallint', 'integer', 'bigint', 'numeric', 'real', 'double precision') THEN
      ALTER TABLE ai_model_groups ALTER COLUMN free TYPE boolean USING (COALESCE(free::numeric, 0) <> 0);
    ELSE
      ALTER TABLE ai_model_groups ALTER COLUMN free TYPE boolean USING (lower(COALESCE(free::text, '')) IN ('1','t','true','yes','y','on'));
    END IF;
  END IF;
  ALTER TABLE ai_model_groups ALTER COLUMN free SET DEFAULT FALSE;
  UPDATE ai_model_groups SET free = FALSE WHERE free IS NULL;
  ALTER TABLE ai_model_groups ALTER COLUMN free SET NOT NULL;

  ALTER TABLE ai_model_groups ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE ai_model_groups ALTER COLUMN position SET DEFAULT 0;
  UPDATE ai_model_groups SET position = 0 WHERE position IS NULL;
  ALTER TABLE ai_model_groups ALTER COLUMN position SET NOT NULL;

  ALTER TABLE ai_model_groups ADD COLUMN IF NOT EXISTS api_key_env_var TEXT NOT NULL DEFAULT '';
  ALTER TABLE ai_model_groups ALTER COLUMN api_key_env_var SET DEFAULT '';
  UPDATE ai_model_groups SET api_key_env_var = '' WHERE api_key_env_var IS NULL;
  ALTER TABLE ai_model_groups ALTER COLUMN api_key_env_var SET NOT NULL;

  ALTER TABLE ai_model_groups ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
  ALTER TABLE ai_model_groups ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
  UPDATE ai_model_groups SET created_at = now() WHERE created_at IS NULL;
  ALTER TABLE ai_model_groups ALTER COLUMN created_at SET DEFAULT now();
  ALTER TABLE ai_model_groups ALTER COLUMN created_at SET NOT NULL;
  ALTER TABLE ai_model_groups ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
  UPDATE ai_model_groups SET updated_at = now() WHERE updated_at IS NULL;
  ALTER TABLE ai_model_groups ALTER COLUMN updated_at SET DEFAULT now();
  ALTER TABLE ai_model_groups ALTER COLUMN updated_at SET NOT NULL;
END $$;

CREATE TABLE IF NOT EXISTS ai_model_variants (
  uid                 UUID         PRIMARY KEY,
  group_uid           UUID         NOT NULL,
  slug                TEXT         NOT NULL,
  provider_model_id   TEXT         NOT NULL,
  label               TEXT         NOT NULL DEFAULT '',
  is_default          BOOLEAN      NOT NULL DEFAULT FALSE,
  position            INTEGER      NOT NULL DEFAULT 0,
  deleted_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
);

DO $$
DECLARE
  dt text;
  r record;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ai_model_variants' AND column_name = 'id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ai_model_variants' AND column_name = 'uid'
  ) THEN
    ALTER TABLE ai_model_variants RENAME COLUMN id TO uid;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ai_model_variants' AND column_name = 'group_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ai_model_variants' AND column_name = 'group_uid'
  ) THEN
    ALTER TABLE ai_model_variants RENAME COLUMN group_id TO group_uid;
  END IF;

  ALTER TABLE ai_model_variants ADD COLUMN IF NOT EXISTS uid UUID;
  SELECT c.data_type INTO dt
  FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.table_name = 'ai_model_variants' AND c.column_name = 'uid'
  LIMIT 1;
  IF dt <> 'uuid' THEN
    ALTER TABLE ai_model_variants ALTER COLUMN uid DROP DEFAULT;
    ALTER TABLE ai_model_variants ALTER COLUMN uid TYPE UUID USING (
      CASE
        WHEN uid::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN uid::text::uuid
        ELSE gen_random_uuid()
      END
    );
  END IF;
  UPDATE ai_model_variants SET uid = gen_random_uuid() WHERE uid IS NULL;
  ALTER TABLE ai_model_variants ALTER COLUMN uid SET DEFAULT gen_random_uuid();
  ALTER TABLE ai_model_variants ALTER COLUMN uid SET NOT NULL;

  ALTER TABLE ai_model_variants ADD COLUMN IF NOT EXISTS group_uid UUID;
  SELECT c.data_type INTO dt
  FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.table_name = 'ai_model_variants' AND c.column_name = 'group_uid'
  LIMIT 1;
  IF dt <> 'uuid' THEN
    ALTER TABLE ai_model_variants ALTER COLUMN group_uid DROP DEFAULT;
    ALTER TABLE ai_model_variants ALTER COLUMN group_uid TYPE UUID USING (
      CASE
        WHEN group_uid::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN group_uid::text::uuid
        ELSE NULL
      END
    );
  END IF;
  UPDATE ai_model_variants
  SET group_uid = (SELECT g.uid FROM ai_model_groups g ORDER BY g.position, g.uid LIMIT 1)
  WHERE group_uid IS NULL
    AND EXISTS (SELECT 1 FROM ai_model_groups);
  IF NOT EXISTS (SELECT 1 FROM ai_model_variants WHERE group_uid IS NULL LIMIT 1) THEN
    ALTER TABLE ai_model_variants ALTER COLUMN group_uid SET NOT NULL;
  END IF;

  ALTER TABLE ai_model_variants ADD COLUMN IF NOT EXISTS slug TEXT NOT NULL DEFAULT '';
  ALTER TABLE ai_model_variants ALTER COLUMN slug SET DEFAULT '';
  UPDATE ai_model_variants SET slug = uid::text WHERE slug IS NULL OR slug = '';
  ALTER TABLE ai_model_variants ALTER COLUMN slug SET NOT NULL;

  ALTER TABLE ai_model_variants ADD COLUMN IF NOT EXISTS provider_model_id TEXT NOT NULL DEFAULT '';
  ALTER TABLE ai_model_variants ALTER COLUMN provider_model_id SET DEFAULT '';
  UPDATE ai_model_variants SET provider_model_id = slug WHERE provider_model_id IS NULL OR provider_model_id = '';
  UPDATE ai_model_variants SET provider_model_id = 'qwen2.5:7b-instruct' WHERE slug = 'qwen2-5-7b-instruct';
  ALTER TABLE ai_model_variants ALTER COLUMN provider_model_id SET NOT NULL;
  ALTER TABLE ai_model_variants ALTER COLUMN provider_model_id DROP DEFAULT;

  ALTER TABLE ai_model_variants ADD COLUMN IF NOT EXISTS label TEXT NOT NULL DEFAULT '';
  ALTER TABLE ai_model_variants ALTER COLUMN label SET DEFAULT '';
  UPDATE ai_model_variants SET label = '' WHERE label IS NULL;
  ALTER TABLE ai_model_variants ALTER COLUMN label SET NOT NULL;

  ALTER TABLE ai_model_variants ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE;
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
  SELECT c.data_type INTO dt
  FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.table_name = 'ai_model_variants' AND c.column_name = 'is_default'
  LIMIT 1;
  IF dt IN ('smallint', 'integer', 'bigint', 'numeric', 'real', 'double precision', 'text', 'character varying', 'character') THEN
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
    IF dt IN ('smallint', 'integer', 'bigint', 'numeric', 'real', 'double precision') THEN
      ALTER TABLE ai_model_variants ALTER COLUMN is_default TYPE boolean USING (COALESCE(is_default::numeric, 0) <> 0);
    ELSE
      ALTER TABLE ai_model_variants ALTER COLUMN is_default TYPE boolean USING (lower(COALESCE(is_default::text, '')) IN ('1','t','true','yes','y','on'));
    END IF;
  END IF;
  ALTER TABLE ai_model_variants ALTER COLUMN is_default SET DEFAULT FALSE;
  UPDATE ai_model_variants SET is_default = FALSE WHERE is_default IS NULL;
  ALTER TABLE ai_model_variants ALTER COLUMN is_default SET NOT NULL;

  ALTER TABLE ai_model_variants ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE ai_model_variants ALTER COLUMN position SET DEFAULT 0;
  UPDATE ai_model_variants SET position = 0 WHERE position IS NULL;
  ALTER TABLE ai_model_variants ALTER COLUMN position SET NOT NULL;

  ALTER TABLE ai_model_variants ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
  ALTER TABLE ai_model_variants ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
  UPDATE ai_model_variants SET created_at = now() WHERE created_at IS NULL;
  ALTER TABLE ai_model_variants ALTER COLUMN created_at SET DEFAULT now();
  ALTER TABLE ai_model_variants ALTER COLUMN created_at SET NOT NULL;
  ALTER TABLE ai_model_variants ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
  UPDATE ai_model_variants SET updated_at = now() WHERE updated_at IS NULL;
  ALTER TABLE ai_model_variants ALTER COLUMN updated_at SET DEFAULT now();
  ALTER TABLE ai_model_variants ALTER COLUMN updated_at SET NOT NULL;
END $$;

CREATE TABLE IF NOT EXISTS ai_chat_logs (
  uid                   UUID         PRIMARY KEY,
  user_uid              UUID,
  group_uid             UUID,
  variant_uid           UUID,
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

DO $$
DECLARE
  dt text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ai_chat_logs' AND column_name = 'id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ai_chat_logs' AND column_name = 'uid'
  ) THEN
    ALTER TABLE ai_chat_logs RENAME COLUMN id TO uid;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ai_chat_logs' AND column_name = 'user_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ai_chat_logs' AND column_name = 'user_uid'
  ) THEN
    ALTER TABLE ai_chat_logs RENAME COLUMN user_id TO user_uid;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ai_chat_logs' AND column_name = 'group_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ai_chat_logs' AND column_name = 'group_uid'
  ) THEN
    ALTER TABLE ai_chat_logs RENAME COLUMN group_id TO group_uid;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ai_chat_logs' AND column_name = 'variant_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ai_chat_logs' AND column_name = 'variant_uid'
  ) THEN
    ALTER TABLE ai_chat_logs RENAME COLUMN variant_id TO variant_uid;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ai_chat_logs' AND column_name = 'user_message_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ai_chat_logs' AND column_name = 'user_message_uid'
  ) THEN
    ALTER TABLE ai_chat_logs RENAME COLUMN user_message_id TO user_message_uid;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ai_chat_logs' AND column_name = 'assistant_message_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ai_chat_logs' AND column_name = 'assistant_message_uid'
  ) THEN
    ALTER TABLE ai_chat_logs RENAME COLUMN assistant_message_id TO assistant_message_uid;
  END IF;

  ALTER TABLE ai_chat_logs ADD COLUMN IF NOT EXISTS uid UUID;
  SELECT c.data_type INTO dt
  FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.table_name = 'ai_chat_logs' AND c.column_name = 'uid'
  LIMIT 1;
  IF dt <> 'uuid' THEN
    ALTER TABLE ai_chat_logs ALTER COLUMN uid DROP DEFAULT;
    ALTER TABLE ai_chat_logs ALTER COLUMN uid TYPE UUID USING (
      CASE
        WHEN uid::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN uid::text::uuid
        ELSE gen_random_uuid()
      END
    );
  END IF;
  UPDATE ai_chat_logs SET uid = gen_random_uuid() WHERE uid IS NULL;
  ALTER TABLE ai_chat_logs ALTER COLUMN uid SET DEFAULT gen_random_uuid();
  ALTER TABLE ai_chat_logs ALTER COLUMN uid SET NOT NULL;

  ALTER TABLE ai_chat_logs ADD COLUMN IF NOT EXISTS user_uid UUID;
  ALTER TABLE ai_chat_logs ADD COLUMN IF NOT EXISTS group_uid UUID;
  ALTER TABLE ai_chat_logs ADD COLUMN IF NOT EXISTS variant_uid UUID;
  SELECT c.data_type INTO dt
  FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.table_name = 'ai_chat_logs' AND c.column_name = 'user_uid'
  LIMIT 1;
  IF dt <> 'uuid' THEN
    ALTER TABLE ai_chat_logs ALTER COLUMN user_uid DROP DEFAULT;
    ALTER TABLE ai_chat_logs ALTER COLUMN user_uid TYPE UUID USING (
      CASE WHEN user_uid::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN user_uid::text::uuid ELSE NULL END
    );
  END IF;
  SELECT c.data_type INTO dt
  FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.table_name = 'ai_chat_logs' AND c.column_name = 'group_uid'
  LIMIT 1;
  IF dt <> 'uuid' THEN
    ALTER TABLE ai_chat_logs ALTER COLUMN group_uid DROP DEFAULT;
    ALTER TABLE ai_chat_logs ALTER COLUMN group_uid TYPE UUID USING (
      CASE WHEN group_uid::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN group_uid::text::uuid ELSE NULL END
    );
  END IF;
  SELECT c.data_type INTO dt
  FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.table_name = 'ai_chat_logs' AND c.column_name = 'variant_uid'
  LIMIT 1;
  IF dt <> 'uuid' THEN
    ALTER TABLE ai_chat_logs ALTER COLUMN variant_uid DROP DEFAULT;
    ALTER TABLE ai_chat_logs ALTER COLUMN variant_uid TYPE UUID USING (
      CASE WHEN variant_uid::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN variant_uid::text::uuid ELSE NULL END
    );
  END IF;
  ALTER TABLE ai_chat_logs ADD COLUMN IF NOT EXISTS message TEXT NOT NULL DEFAULT '';
  UPDATE ai_chat_logs SET message = '' WHERE message IS NULL;
  ALTER TABLE ai_chat_logs ALTER COLUMN message SET NOT NULL;
  ALTER TABLE ai_chat_logs ADD COLUMN IF NOT EXISTS reply TEXT NOT NULL DEFAULT '';
  UPDATE ai_chat_logs SET reply = '' WHERE reply IS NULL;
  ALTER TABLE ai_chat_logs ALTER COLUMN reply SET NOT NULL;
  ALTER TABLE ai_chat_logs ADD COLUMN IF NOT EXISTS user_message_uid UUID;
  SELECT c.data_type INTO dt
  FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.table_name = 'ai_chat_logs' AND c.column_name = 'user_message_uid'
  LIMIT 1;
  IF dt <> 'uuid' THEN
    ALTER TABLE ai_chat_logs ALTER COLUMN user_message_uid DROP DEFAULT;
    ALTER TABLE ai_chat_logs ALTER COLUMN user_message_uid TYPE UUID USING (
      CASE
        WHEN user_message_uid::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN user_message_uid::text::uuid
        ELSE gen_random_uuid()
      END
    );
  END IF;
  UPDATE ai_chat_logs SET user_message_uid = gen_random_uuid() WHERE user_message_uid IS NULL;
  ALTER TABLE ai_chat_logs ALTER COLUMN user_message_uid SET DEFAULT gen_random_uuid();
  ALTER TABLE ai_chat_logs ALTER COLUMN user_message_uid SET NOT NULL;
  ALTER TABLE ai_chat_logs ADD COLUMN IF NOT EXISTS assistant_message_uid UUID;
  SELECT c.data_type INTO dt
  FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.table_name = 'ai_chat_logs' AND c.column_name = 'assistant_message_uid'
  LIMIT 1;
  IF dt <> 'uuid' THEN
    ALTER TABLE ai_chat_logs ALTER COLUMN assistant_message_uid DROP DEFAULT;
    ALTER TABLE ai_chat_logs ALTER COLUMN assistant_message_uid TYPE UUID USING (
      CASE
        WHEN assistant_message_uid::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN assistant_message_uid::text::uuid
        ELSE gen_random_uuid()
      END
    );
  END IF;
  UPDATE ai_chat_logs SET assistant_message_uid = gen_random_uuid() WHERE assistant_message_uid IS NULL;
  ALTER TABLE ai_chat_logs ALTER COLUMN assistant_message_uid SET DEFAULT gen_random_uuid();
  ALTER TABLE ai_chat_logs ALTER COLUMN assistant_message_uid SET NOT NULL;
  ALTER TABLE ai_chat_logs ADD COLUMN IF NOT EXISTS client_ip INET;
  ALTER TABLE ai_chat_logs ADD COLUMN IF NOT EXISTS user_agent TEXT;
  ALTER TABLE ai_chat_logs ADD COLUMN IF NOT EXISTS editor_mode TEXT NOT NULL DEFAULT 'note';
  UPDATE ai_chat_logs SET editor_mode = 'note' WHERE editor_mode IS NULL OR editor_mode NOT IN ('note','media','short','play','film');
  ALTER TABLE ai_chat_logs ALTER COLUMN editor_mode SET DEFAULT 'note';
  ALTER TABLE ai_chat_logs ALTER COLUMN editor_mode SET NOT NULL;
  ALTER TABLE ai_chat_logs ADD COLUMN IF NOT EXISTS note_context JSONB;
  ALTER TABLE ai_chat_logs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
  UPDATE ai_chat_logs SET created_at = now() WHERE created_at IS NULL;
  ALTER TABLE ai_chat_logs ALTER COLUMN created_at SET DEFAULT now();
  ALTER TABLE ai_chat_logs ALTER COLUMN created_at SET NOT NULL;
END $$;

CREATE TABLE IF NOT EXISTS user_ui_preferences (
  user_uid    UUID         PRIMARY KEY,
  data        JSONB        NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

DO $$
DECLARE
  dt text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_ui_preferences' AND column_name = 'user_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_ui_preferences' AND column_name = 'user_uid'
  ) THEN
    ALTER TABLE user_ui_preferences RENAME COLUMN user_id TO user_uid;
  END IF;
  ALTER TABLE user_ui_preferences ADD COLUMN IF NOT EXISTS user_uid UUID;
  SELECT c.data_type INTO dt
  FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.table_name = 'user_ui_preferences' AND c.column_name = 'user_uid'
  LIMIT 1;
  IF dt <> 'uuid' THEN
    ALTER TABLE user_ui_preferences ALTER COLUMN user_uid DROP DEFAULT;
    ALTER TABLE user_ui_preferences ALTER COLUMN user_uid TYPE UUID USING (
      CASE
        WHEN user_uid::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN user_uid::text::uuid
        ELSE gen_random_uuid()
      END
    );
  END IF;
  UPDATE user_ui_preferences SET user_uid = gen_random_uuid() WHERE user_uid IS NULL;
  ALTER TABLE user_ui_preferences ALTER COLUMN user_uid SET NOT NULL;
  ALTER TABLE user_ui_preferences ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}'::jsonb;
  UPDATE user_ui_preferences SET data = '{}'::jsonb WHERE data IS NULL;
  ALTER TABLE user_ui_preferences ALTER COLUMN data SET DEFAULT '{}'::jsonb;
  ALTER TABLE user_ui_preferences ALTER COLUMN data SET NOT NULL;
  ALTER TABLE user_ui_preferences ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
  UPDATE user_ui_preferences SET created_at = now() WHERE created_at IS NULL;
  ALTER TABLE user_ui_preferences ALTER COLUMN created_at SET DEFAULT now();
  ALTER TABLE user_ui_preferences ALTER COLUMN created_at SET NOT NULL;
  ALTER TABLE user_ui_preferences ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
  UPDATE user_ui_preferences SET updated_at = now() WHERE updated_at IS NULL;
  ALTER TABLE user_ui_preferences ALTER COLUMN updated_at SET DEFAULT now();
  ALTER TABLE user_ui_preferences ALTER COLUMN updated_at SET NOT NULL;
END $$;

DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS uq_users_uid ON users(uid);
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'Skipping uq_users_uid because legacy users.uid contains duplicates';
END $$;

DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_groups_uid ON ai_model_groups(uid);
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'Skipping uq_ai_groups_uid because legacy ai_model_groups.uid contains duplicates';
END $$;

DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_variants_uid ON ai_model_variants(uid);
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'Skipping uq_ai_variants_uid because legacy ai_model_variants.uid contains duplicates';
END $$;

DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_groups_slug_active
    ON ai_model_groups(slug) WHERE deleted_at IS NULL;
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'Skipping uq_ai_groups_slug_active because legacy active group slugs contain duplicates';
END $$;

CREATE INDEX IF NOT EXISTS idx_ai_groups_free_position
  ON ai_model_groups(position) WHERE deleted_at IS NULL AND free;

DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_variants_slug_active
    ON ai_model_variants(group_uid, slug) WHERE deleted_at IS NULL;
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'Skipping uq_ai_variants_slug_active because legacy active variant slugs contain duplicates';
END $$;

DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_variants_default_per_group_active
    ON ai_model_variants(group_uid) WHERE deleted_at IS NULL AND is_default;
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'Skipping uq_ai_variants_default_per_group_active because legacy groups contain multiple defaults';
END $$;

CREATE INDEX IF NOT EXISTS idx_ai_chat_logs_created       ON ai_chat_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_chat_logs_user_created  ON ai_chat_logs(user_uid, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_chat_logs_group_created ON ai_chat_logs(group_uid, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_chat_logs_variant       ON ai_chat_logs(variant_uid);
CREATE INDEX IF NOT EXISTS idx_ai_chat_logs_message_trgm  ON ai_chat_logs USING gin (message gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_ai_chat_logs_reply_trgm    ON ai_chat_logs USING gin (reply   gin_trgm_ops);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_role_check') THEN
    ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('user','admin')) NOT VALID;
  END IF;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_chat_logs_editor_mode_check') THEN
    ALTER TABLE ai_chat_logs ADD CONSTRAINT ai_chat_logs_editor_mode_check CHECK (editor_mode IN ('note','media','short','play','film')) NOT VALID;
  END IF;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_model_variants_group_uid_fkey') THEN
    ALTER TABLE ai_model_variants
      ADD CONSTRAINT ai_model_variants_group_uid_fkey
      FOREIGN KEY (group_uid) REFERENCES ai_model_groups(uid) ON DELETE CASCADE NOT VALID;
  END IF;
EXCEPTION WHEN invalid_foreign_key OR undefined_column OR duplicate_object THEN
  RAISE NOTICE 'Skipping ai_model_variants_group_uid_fkey until legacy key columns are clean';
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_chat_logs_user_uid_fkey') THEN
    ALTER TABLE ai_chat_logs
      ADD CONSTRAINT ai_chat_logs_user_uid_fkey
      FOREIGN KEY (user_uid) REFERENCES users(uid) ON DELETE SET NULL NOT VALID;
  END IF;
EXCEPTION WHEN invalid_foreign_key OR undefined_column OR duplicate_object THEN
  RAISE NOTICE 'Skipping ai_chat_logs_user_uid_fkey until legacy key columns are clean';
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_chat_logs_group_uid_fkey') THEN
    ALTER TABLE ai_chat_logs
      ADD CONSTRAINT ai_chat_logs_group_uid_fkey
      FOREIGN KEY (group_uid) REFERENCES ai_model_groups(uid) ON DELETE SET NULL NOT VALID;
  END IF;
EXCEPTION WHEN invalid_foreign_key OR undefined_column OR duplicate_object THEN
  RAISE NOTICE 'Skipping ai_chat_logs_group_uid_fkey until legacy key columns are clean';
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_chat_logs_variant_uid_fkey') THEN
    ALTER TABLE ai_chat_logs
      ADD CONSTRAINT ai_chat_logs_variant_uid_fkey
      FOREIGN KEY (variant_uid) REFERENCES ai_model_variants(uid) ON DELETE SET NULL NOT VALID;
  END IF;
EXCEPTION WHEN invalid_foreign_key OR undefined_column OR duplicate_object THEN
  RAISE NOTICE 'Skipping ai_chat_logs_variant_uid_fkey until legacy key columns are clean';
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_ui_preferences_user_uid_fkey') THEN
    ALTER TABLE user_ui_preferences
      ADD CONSTRAINT user_ui_preferences_user_uid_fkey
      FOREIGN KEY (user_uid) REFERENCES users(uid) ON DELETE CASCADE NOT VALID;
  END IF;
EXCEPTION WHEN invalid_foreign_key OR undefined_column OR duplicate_object THEN
  RAISE NOTICE 'Skipping user_ui_preferences_user_uid_fkey until legacy key columns are clean';
END $$;

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_ai_groups_updated_at ON ai_model_groups;
CREATE TRIGGER trg_ai_groups_updated_at BEFORE UPDATE ON ai_model_groups
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_ai_variants_updated_at ON ai_model_variants;
CREATE TRIGGER trg_ai_variants_updated_at BEFORE UPDATE ON ai_model_variants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_user_ui_prefs_updated_at ON user_ui_preferences;
CREATE TRIGGER trg_user_ui_prefs_updated_at BEFORE UPDATE ON user_ui_preferences
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
