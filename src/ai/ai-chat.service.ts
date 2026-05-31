import crypto from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { SqliteService } from '../database/sqlite.service';
import { InMemoryJobRunnerService } from '../jobs/in-memory-job-runner.service';
import { UsersService } from '../users/users.service';
import type { PublicUser } from '../users/users.types';
import { AiCatalogService } from './ai-catalog.service';
import type { AiGroupRow, AiVariantRow } from './ai.types';
import { boolFromDb, nowIso, toInt } from '../common/time';
import { badRequest, forbidden, notFound, paymentRequired } from '../common/http-error';

/** Credits (Krill / OWK) charged per request to a paid (non-free) model group. */
export const CREDITS_PER_PAID_REQUEST = 12;

interface ChatCompletion {
  status: 'pending' | 'completed' | 'failed';
  data?: Record<string, unknown>;
  error?: string;
  clients: Set<Response>;
}

@Injectable()
export class AiChatService {
  private readonly completions = new Map<string, ChatCompletion>();

  constructor(private readonly db: SqliteService, private readonly catalog: AiCatalogService, private readonly jobs: InMemoryJobRunnerService, private readonly users: UsersService) {}

  accept(body: { message?: string; group_uid?: string; variant_uid?: string; editor_mode?: string; note_context?: unknown }, user: PublicUser | null, request: Request) {
    const message = body.message?.trim();
    if (!message) badRequest('message is required');
    if (!body.group_uid || !body.variant_uid) badRequest('group_uid and variant_uid are required');
    const group = this.catalog.getGroup(body.group_uid);
    const variant = this.catalog.getVariant(body.variant_uid);

    // Paid model groups are charged in Krill (OWK) up front; free groups cost nothing.
    let credits: number | undefined;
    if (!boolFromDb(group.free)) {
      if (!user) forbidden('Войдите, чтобы использовать платные модели');
      const remaining = this.users.tryCharge(user.uid, CREDITS_PER_PAID_REQUEST);
      if (remaining === null) paymentRequired('Недостаточно кредитов');
      credits = remaining;
    }

    const requestUid = crypto.randomUUID();
    const userMessageUid = crypto.randomUUID();
    const assistantMessageUid = crypto.randomUUID();
    this.completions.set(requestUid, { status: 'pending', clients: new Set() });
    this.jobs.enqueue('ai-chat', async () => this.processChat({ requestUid, userMessageUid, assistantMessageUid, message, group, variant, user, request, editorMode: body.editor_mode ?? null, noteContext: body.note_context ?? null }), { attempts: 1 });
    return { request_uid: requestUid, user_message_uid: userMessageUid, assistant_message_uid: assistantMessageUid, credits };
  }

  stream(requestUid: string, response: Response): void {
    const completion = this.completions.get(requestUid);
    if (!completion) notFound(`AI chat request "${requestUid}" not found`);
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.flushHeaders?.();
    if (completion.status !== 'pending') {
      this.sendCompletion(response, completion);
      return;
    }
    completion.clients.add(response);
    response.write(`event: ready\ndata: {"request_uid":"${requestUid}"}\n\n`);
    response.on('close', () => completion.clients.delete(response));
  }

  listLogs(query: Record<string, unknown>) {
    const limit = Math.min(200, Math.max(1, toInt(query.limit, 50)));
    const offset = Math.max(0, toInt(query.offset, 0));
    const clauses: string[] = [];
    const params: Array<string | number> = [];
    const addLike = (column: string, value: unknown) => {
      if (typeof value === 'string' && value.trim()) {
        clauses.push(`${column} LIKE ?`);
        params.push(`%${value.trim()}%`);
      }
    };
    addLike('l.message', query.message_contains);
    addLike('l.reply', query.reply_contains);
    addLike('l.client_ip', query.client_ip);
    addLike('l.user_agent', query.user_agent);
    addLike('u.username', query.username_contains ?? query.login_contains);
    addLike('u.email', query.email_contains);
    if (typeof query.editor_mode === 'string' && query.editor_mode) {
      clauses.push('l.editor_mode = ?');
      params.push(query.editor_mode);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db.all<Record<string, unknown>>(
      `SELECT l.*, u.id AS user_id, u.username, u.email, g.slug AS group_slug, g.label AS group_label, g.deleted_at AS group_deleted_at,
              v.slug AS variant_slug, v.label AS variant_label, v.deleted_at AS variant_deleted_at
       FROM ai_chat_logs l
       LEFT JOIN users u ON u.uid = l.user_uid
       LEFT JOIN ai_groups g ON g.uid = l.group_uid
       LEFT JOIN ai_variants v ON v.uid = l.variant_uid
       ${where}
       ORDER BY l.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    const total = this.db.get<{ total: number }>(
      `SELECT COUNT(*) AS total FROM ai_chat_logs l LEFT JOIN users u ON u.uid = l.user_uid ${where}`,
      params,
    )?.total ?? 0;
    return { items: rows.map((row) => this.serializeLog(row)), total };
  }

  private async processChat(input: { requestUid: string; userMessageUid: string; assistantMessageUid: string; message: string; group: AiGroupRow; variant: AiVariantRow; user: PublicUser | null; request: Request; editorMode: string | null; noteContext: unknown }) {
    const completion = this.completions.get(input.requestUid);
    if (!completion) return;
    try {
      const reply = await this.generateReply(input.message, input.group, input.variant);
      const data = { reply, user_message_uid: input.userMessageUid, assistant_message_uid: input.assistantMessageUid };
      const now = nowIso();
      this.db.run(
        `INSERT INTO ai_chat_logs (uid, created_at, user_uid, group_uid, variant_uid, message, reply, user_message_uid, assistant_message_uid, client_ip, user_agent, editor_mode, note_context_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [input.requestUid, now, input.user?.uid ?? null, input.group.uid, input.variant.uid, input.message, reply, input.userMessageUid, input.assistantMessageUid, input.request.ip ?? null, input.request.headers['user-agent'] ?? null, input.editorMode, input.noteContext ? JSON.stringify(input.noteContext) : null],
      );
      completion.status = 'completed';
      completion.data = data;
    } catch (error) {
      completion.status = 'failed';
      completion.error = error instanceof Error ? error.message : String(error);
    }
    for (const client of completion.clients) this.sendCompletion(client, completion);
    completion.clients.clear();
  }

  private async generateReply(message: string, group: AiGroupRow, variant: AiVariantRow): Promise<string> {
    const apiKey = group.api_key_env_var ? process.env[group.api_key_env_var] : undefined;
    if (apiKey && group.api_key_env_var === 'ANTHROPIC_API_KEY') {
      const base = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, '');
      const response = await fetch(`${base}/v1/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: variant.provider_model_id, max_tokens: 1024, messages: [{ role: 'user', content: message }] }),
      });
      if (response.ok) {
        const payload = await response.json() as { content?: Array<{ type?: string; text?: string }> };
        const text = payload.content?.map((part) => part.text).filter(Boolean).join('\n').trim();
        if (text) return text;
      }
    }
    return `AI provider "${group.label}" is configured for model "${variant.label}", but no reachable provider key is available on this server. User message: ${message}`;
  }

  private sendCompletion(response: Response, completion: ChatCompletion): void {
    if (completion.status === 'completed') {
      response.write(`event: complete\ndata: ${JSON.stringify(completion.data)}\n\n`);
    } else {
      response.write(`event: error\ndata: ${JSON.stringify({ error: completion.error ?? 'AI chat failed' })}\n\n`);
    }
    response.end();
  }

  private serializeLog(row: Record<string, unknown>) {
    const noteContext = typeof row.note_context_json === 'string' && row.note_context_json ? JSON.parse(row.note_context_json) as Record<string, unknown> : null;
    return {
      id: Number(row.id),
      uid: row.uid,
      created_at: row.created_at,
      user_id: row.user_id ? Number(row.user_id) : null,
      user_uid: row.user_uid,
      group_uid: row.group_uid,
      variant_uid: row.variant_uid,
      message: row.message,
      group_slug: row.group_slug ?? '',
      variant_slug: row.variant_slug ?? '',
      reply: row.reply,
      user_message_id: row.user_message_uid,
      user_message_uid: row.user_message_uid,
      assistant_message_id: row.assistant_message_uid,
      assistant_message_uid: row.assistant_message_uid,
      client_ip: row.client_ip,
      user_agent: row.user_agent,
      editor_mode: row.editor_mode,
      note_context: noteContext,
      user: row.user_id ? { id: Number(row.user_id), uid: row.user_uid, login: row.username, username: row.username, email: row.email } : null,
      group: row.group_uid ? { uid: row.group_uid, slug: row.group_slug, label: row.group_label, deleted_at: row.group_deleted_at } : null,
      variant: row.variant_uid ? { uid: row.variant_uid, slug: row.variant_slug, label: row.variant_label, deleted_at: row.variant_deleted_at } : null,
    };
  }
}
