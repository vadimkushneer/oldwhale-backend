import { mkdirSync } from 'node:fs';
import crypto from 'node:crypto';
import { dirname } from 'node:path';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { readSqlitePath } from '../config/env';

export type SqlParam = string | number | bigint | null;
export type SqlParams = SqlParam[];

@Injectable()
export class SqliteService implements OnModuleInit {
  private db!: DatabaseSync;

  onModuleInit(): void {
    const sqlitePath = readSqlitePath();
    mkdirSync(dirname(sqlitePath), { recursive: true });
    this.db = new DatabaseSync(sqlitePath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    this.migrate();
    this.seedCatalog();
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  prepare(sql: string): StatementSync {
    return this.db.prepare(sql);
  }

  run(
    sql: string,
    params: SqlParams = [],
  ): { changes: number | bigint; lastInsertRowid: number | bigint } {
    return this.prepare(sql).run(...params);
  }

  get<T>(sql: string, params: SqlParams = []): T | undefined {
    return this.prepare(sql).get(...params) as T | undefined;
  }

  all<T>(sql: string, params: SqlParams = []): T[] {
    return this.prepare(sql).all(...params) as T[];
  }

  transaction<T>(fn: () => T): T {
    this.exec('BEGIN IMMEDIATE;');
    try {
      const result = fn();
      this.exec('COMMIT;');
      return result;
    } catch (error) {
      this.exec('ROLLBACK;');
      throw error;
    }
  }

  private migrate(): void {
    this.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uid TEXT NOT NULL UNIQUE,
        username TEXT NOT NULL UNIQUE,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('user', 'admin')),
        disabled INTEGER NOT NULL DEFAULT 0,
        credits INTEGER NOT NULL DEFAULT 0,
        last_login_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS pending_registrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uid TEXT NOT NULL UNIQUE,
        email TEXT NOT NULL UNIQUE,
        otp_hash TEXT NOT NULL,
        otp_expires_at TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        setup_token_hash TEXT,
        setup_token_expires_at TEXT,
        verified_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uid TEXT NOT NULL UNIQUE,
        user_uid TEXT NOT NULL,
        email TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_uid) REFERENCES users(uid) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_email_created
        ON password_reset_tokens (email, created_at);

      CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_unused
        ON password_reset_tokens (user_uid, used_at);

      CREATE TABLE IF NOT EXISTS email_delivery_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uid TEXT NOT NULL UNIQUE,
        purpose TEXT NOT NULL,
        status TEXT NOT NULL,
        recipient TEXT NOT NULL,
        recipient_domain TEXT NOT NULL,
        sender TEXT NOT NULL,
        subject TEXT NOT NULL,
        smtp_host TEXT,
        smtp_port INTEGER,
        smtp_secure INTEGER NOT NULL DEFAULT 0,
        smtp_auth_configured INTEGER NOT NULL DEFAULT 0,
        message_id TEXT,
        envelope_json TEXT,
        accepted_json TEXT,
        rejected_json TEXT,
        pending_json TEXT,
        response TEXT,
        queue_id TEXT,
        error_name TEXT,
        error_message TEXT,
        error_code TEXT,
        error_command TEXT,
        error_response TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_email_delivery_logs_recipient_created
        ON email_delivery_logs (recipient, created_at);

      CREATE INDEX IF NOT EXISTS idx_email_delivery_logs_status_created
        ON email_delivery_logs (status, created_at);

      CREATE TABLE IF NOT EXISTS admin_ui_settings (
        user_uid TEXT PRIMARY KEY,
        ai_chat_log_columns_json TEXT NOT NULL,
        updated_at TEXT,
        FOREIGN KEY (user_uid) REFERENCES users(uid) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS ai_groups (
        uid TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL,
        role TEXT NOT NULL,
        color TEXT NOT NULL,
        free INTEGER NOT NULL DEFAULT 0,
        position INTEGER NOT NULL DEFAULT 0,
        api_key_env_var TEXT NOT NULL DEFAULT '',
        deleted_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ai_variants (
        uid TEXT PRIMARY KEY,
        group_uid TEXT NOT NULL,
        slug TEXT NOT NULL,
        provider_model_id TEXT NOT NULL,
        label TEXT NOT NULL,
        is_default INTEGER NOT NULL DEFAULT 0,
        position INTEGER NOT NULL DEFAULT 0,
        deleted_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(group_uid, slug),
        FOREIGN KEY (group_uid) REFERENCES ai_groups(uid) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS ai_chat_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uid TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        user_uid TEXT,
        group_uid TEXT,
        variant_uid TEXT,
        message TEXT NOT NULL,
        reply TEXT NOT NULL,
        user_message_uid TEXT NOT NULL,
        assistant_message_uid TEXT NOT NULL,
        client_ip TEXT,
        user_agent TEXT,
        editor_mode TEXT,
        note_context_json TEXT,
        FOREIGN KEY (user_uid) REFERENCES users(uid) ON DELETE SET NULL,
        FOREIGN KEY (group_uid) REFERENCES ai_groups(uid) ON DELETE SET NULL,
        FOREIGN KEY (variant_uid) REFERENCES ai_variants(uid) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS llm_groups (
        uid TEXT PRIMARY KEY,
        api_key_env_var TEXT NOT NULL,
        models_list_request_url TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS llm_models (
        uid TEXT PRIMARY KEY,
        llm_group_uid TEXT NOT NULL,
        name TEXT NOT NULL,
        display_name TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(llm_group_uid, name),
        FOREIGN KEY (llm_group_uid) REFERENCES llm_groups(uid) ON DELETE CASCADE
      );

      -- VTB Kazakhstan eCommerce payments: one row per credit (OWK) top-up attempt.
      CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uid TEXT NOT NULL UNIQUE,
        order_number TEXT NOT NULL UNIQUE,
        user_uid TEXT NOT NULL,
        credits INTEGER NOT NULL,
        amount_minor INTEGER NOT NULL,
        currency TEXT NOT NULL,
        status TEXT NOT NULL,
        gateway_order_id TEXT,
        form_url TEXT,
        return_url TEXT,
        fail_url TEXT,
        order_status INTEGER,
        action_code TEXT,
        error_code TEXT,
        error_message TEXT,
        raw_last_gateway_response TEXT,
        credited_at TEXT,
        expires_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_uid) REFERENCES users(uid) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_payments_user_created
        ON payments (user_uid, created_at);

      CREATE INDEX IF NOT EXISTS idx_payments_gateway_order
        ON payments (gateway_order_id);

      CREATE INDEX IF NOT EXISTS idx_payments_status_created
        ON payments (status, created_at);

      -- Append-only audit trail mirrored to stdout logs for forensic debugging.
      CREATE TABLE IF NOT EXISTS payment_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uid TEXT NOT NULL UNIQUE,
        payment_uid TEXT NOT NULL,
        type TEXT NOT NULL,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        detail_json TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (payment_uid) REFERENCES payments(uid) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_payment_events_payment_created
        ON payment_events (payment_uid, created_at);
    `);

    // Additive migrations for databases created before a column existed.
    this.ensureColumn('users', 'credits', 'INTEGER NOT NULL DEFAULT 0');
  }

  /** Adds a column to an existing table when it is missing (idempotent). */
  private ensureColumn(table: string, column: string, definition: string): void {
    const columns = this.all<{ name: string }>(`PRAGMA table_info(${table})`);
    if (columns.some((c) => c.name === column)) return;
    try {
      this.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
      // Surfaced once at boot so deployments can confirm the migration ran.
      console.log(`[sqlite] migration: added column ${table}.${column}`);
    } catch (error) {
      // Tolerate the column already existing (e.g. a concurrent boot added it first).
      if (!String(error).toLowerCase().includes('duplicate column')) throw error;
    }
  }

  private seedCatalog(): void {
    const count = this.get<{ count: number }>('SELECT COUNT(*) AS count FROM ai_groups')?.count ?? 0;
    if (count > 0) return;

    const now = new Date().toISOString();
    const groups = [
      { uid: '11111111-1111-4111-8111-111111111111', slug: 'deepseek', label: 'DeepSeek', role: 'Черновик', color: '#4ade80', free: 1, position: 1, api: 'DEEPSEEK_API_KEY' },
      { uid: '22222222-2222-4222-8222-222222222222', slug: 'claude', label: 'Claude', role: 'Редактура', color: '#7c6af7', free: 0, position: 2, api: 'ANTHROPIC_API_KEY' },
      { uid: '33333333-3333-4333-8333-333333333333', slug: 'gpt', label: 'GPT', role: 'Идеи', color: '#f472b6', free: 0, position: 3, api: 'OPENAI_API_KEY' },
      { uid: '44444444-4444-4444-8444-444444444444', slug: 'grok', label: 'Grok', role: 'Идеи', color: '#f59e0b', free: 0, position: 4, api: 'GROK_API_KEY' },
      { uid: '55555555-5555-4555-8555-555555555555', slug: 'gemini', label: 'Gemini', role: 'Идеи', color: '#60a5fa', free: 0, position: 5, api: 'GEMINI_API_KEY' },
    ];
    const variants: Record<string, string[]> = {
      deepseek: ['deepseek-v3-2', 'deepseek-chat', 'deepseek-v3-2-exp', 'deepseek-v4'],
      claude: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
      gpt: ['gpt-5-4-thinking', 'gpt-5-4-pro', 'gpt-5-4-mini'],
      grok: ['grok-4-20', 'grok-4-1-fast', 'grok-4-1-fast-nr'],
      gemini: ['gemini-3-flash', 'gemini-3-pro', 'gemini-1-5-pro'],
    };

    this.transaction(() => {
      for (const group of groups) {
        this.run(
          `INSERT INTO ai_groups (uid, slug, label, role, color, free, position, api_key_env_var, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [group.uid, group.slug, group.label, group.role, group.color, group.free, group.position, group.api, now, now],
        );
        variants[group.slug].forEach((model, index) => {
          this.run(
            `INSERT INTO ai_variants (uid, group_uid, slug, provider_model_id, label, is_default, position, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [crypto.randomUUID(), group.uid, model, model, model, index === 0 ? 1 : 0, index + 1, now, now],
          );
        });
      }
    });
  }
}
