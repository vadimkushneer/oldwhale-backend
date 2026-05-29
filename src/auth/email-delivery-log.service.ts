import crypto from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { nowIso, toInt } from '../common/time';
import { SqliteService, type SqlParam } from '../database/sqlite.service';

export type EmailDeliveryStatus =
  | 'attempting'
  | 'accepted_by_smtp'
  | 'failed'
  | 'logged_to_console';

export interface CreateEmailDeliveryLogInput {
  purpose: string;
  recipient: string;
  sender: string;
  subject: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure: boolean;
  smtpAuthConfigured: boolean;
}

export interface CompleteEmailDeliveryLogInput {
  status: EmailDeliveryStatus;
  messageId?: string;
  envelope?: unknown;
  accepted?: unknown;
  rejected?: unknown;
  pending?: unknown;
  response?: string;
  error?: unknown;
}

@Injectable()
export class EmailDeliveryLogService {
  constructor(private readonly db: SqliteService) {}

  createAttempt(input: CreateEmailDeliveryLogInput): string {
    const uid = crypto.randomUUID();
    const now = nowIso();
    this.db.run(
      `INSERT INTO email_delivery_logs (
        uid, purpose, status, recipient, recipient_domain, sender, subject,
        smtp_host, smtp_port, smtp_secure, smtp_auth_configured, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uid,
        input.purpose,
        'attempting',
        input.recipient,
        this.recipientDomain(input.recipient),
        input.sender,
        input.subject,
        input.smtpHost ?? null,
        input.smtpPort ?? null,
        input.smtpSecure ? 1 : 0,
        input.smtpAuthConfigured ? 1 : 0,
        now,
        now,
      ],
    );
    return uid;
  }

  complete(uid: string, input: CompleteEmailDeliveryLogInput): void {
    const error = this.serializeError(input.error);
    this.db.run(
      `UPDATE email_delivery_logs SET
        status = ?,
        message_id = ?,
        envelope_json = ?,
        accepted_json = ?,
        rejected_json = ?,
        pending_json = ?,
        response = ?,
        queue_id = ?,
        error_name = ?,
        error_message = ?,
        error_code = ?,
        error_command = ?,
        error_response = ?,
        updated_at = ?
       WHERE uid = ?`,
      [
        input.status,
        input.messageId ?? null,
        this.jsonOrNull(input.envelope),
        this.jsonOrNull(input.accepted),
        this.jsonOrNull(input.rejected),
        this.jsonOrNull(input.pending),
        input.response ?? null,
        this.extractQueueId(input.response),
        error.name,
        error.message,
        error.code,
        error.command,
        error.response,
        nowIso(),
        uid,
      ],
    );
  }

  list(query: Record<string, unknown>) {
    const limit = Math.min(200, Math.max(1, toInt(query.limit, 50)));
    const offset = Math.max(0, toInt(query.offset, 0));
    const clauses: string[] = [];
    const params: SqlParam[] = [];

    this.addLike(clauses, params, 'recipient', query.recipient);
    this.addLike(clauses, params, 'recipient_domain', query.recipient_domain);
    this.addLike(clauses, params, 'status', query.status);
    this.addLike(clauses, params, 'queue_id', query.queue_id);

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const items = this.db.all<Record<string, unknown>>(
      `SELECT * FROM email_delivery_logs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    const total =
      this.db.get<{ total: number }>(
        `SELECT COUNT(*) AS total FROM email_delivery_logs ${where}`,
        params,
      )?.total ?? 0;

    return {
      items: items.map((item) => this.serializeRow(item)),
      total,
    };
  }

  private addLike(
    clauses: string[],
    params: SqlParam[],
    column: string,
    value: unknown,
  ): void {
    if (typeof value !== 'string' || !value.trim()) return;
    clauses.push(`${column} LIKE ?`);
    params.push(`%${value.trim()}%`);
  }

  private serializeRow(row: Record<string, unknown>) {
    return {
      ...row,
      smtp_secure: row.smtp_secure === 1,
      smtp_auth_configured: row.smtp_auth_configured === 1,
      envelope: this.parseJson(row.envelope_json),
      accepted: this.parseJson(row.accepted_json),
      rejected: this.parseJson(row.rejected_json),
      pending: this.parseJson(row.pending_json),
      envelope_json: undefined,
      accepted_json: undefined,
      rejected_json: undefined,
      pending_json: undefined,
    };
  }

  private recipientDomain(email: string): string {
    return email.split('@')[1]?.toLowerCase() ?? '';
  }

  private jsonOrNull(value: unknown): string | null {
    if (value === undefined || value === null) return null;
    return JSON.stringify(value);
  }

  private parseJson(value: unknown): unknown {
    if (typeof value !== 'string' || !value) return null;
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  private extractQueueId(response: string | undefined): string | null {
    if (!response) return null;
    return response.match(/\bqueued as\s+([A-F0-9]+)\b/i)?.[1] ?? null;
  }

  private serializeError(error: unknown): {
    name: string | null;
    message: string | null;
    code: string | null;
    command: string | null;
    response: string | null;
  } {
    if (!error || typeof error !== 'object') {
      return {
        name: null,
        message: error ? String(error) : null,
        code: null,
        command: null,
        response: null,
      };
    }
    const record = error as Record<string, unknown>;
    return {
      name: typeof record.name === 'string' ? record.name : null,
      message: typeof record.message === 'string' ? record.message : String(error),
      code: typeof record.code === 'string' ? record.code : null,
      command: typeof record.command === 'string' ? record.command : null,
      response: typeof record.response === 'string' ? record.response : null,
    };
  }
}
