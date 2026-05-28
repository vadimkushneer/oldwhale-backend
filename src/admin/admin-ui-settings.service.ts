import { Injectable } from '@nestjs/common';
import { SqliteService } from '../database/sqlite.service';
import { nowIso } from '../common/time';

const DEFAULT_COLUMNS: Record<string, boolean> = {
  id: true,
  time: true,
  user: true,
  message: true,
  reply: true,
  model: true,
  message_ids: false,
  ip_ua: false,
  editor_mode: true,
  note_context: false,
};

@Injectable()
export class AdminUiSettingsService {
  constructor(private readonly db: SqliteService) {}

  get(userUid: string) {
    const row = this.db.get<{ ai_chat_log_columns_json: string; updated_at: string | null }>(
      'SELECT ai_chat_log_columns_json, updated_at FROM admin_ui_settings WHERE user_uid = ?',
      [userUid],
    );
    return {
      aiChatLogTable: {
        columns: row ? JSON.parse(row.ai_chat_log_columns_json) as Record<string, boolean> : DEFAULT_COLUMNS,
        updated_at: row?.updated_at ?? null,
      },
    };
  }

  put(userUid: string, body: { aiChatLogTable?: { columns?: Record<string, boolean> } }) {
    const columns = body.aiChatLogTable?.columns ?? DEFAULT_COLUMNS;
    const updatedAt = nowIso();
    this.db.run(
      `INSERT INTO admin_ui_settings (user_uid, ai_chat_log_columns_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_uid) DO UPDATE SET ai_chat_log_columns_json = excluded.ai_chat_log_columns_json, updated_at = excluded.updated_at`,
      [userUid, JSON.stringify(columns), updatedAt],
    );
    return this.get(userUid);
  }
}
