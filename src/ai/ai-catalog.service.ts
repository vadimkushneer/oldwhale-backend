import crypto from 'node:crypto';
import { BadGatewayException, Injectable } from '@nestjs/common';
import { boolFromDb, nowIso, toInt } from '../common/time';
import { badRequest, conflict, notFound } from '../common/http-error';
import { SqliteService } from '../database/sqlite.service';
import type { AiGroupRow, AiVariantRow } from './ai.types';
import type { PublicUser } from '../users/users.types';

function safeSlug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || crypto.randomUUID();
}

@Injectable()
export class AiCatalogService {
  constructor(private readonly db: SqliteService) {}

  providers() {
    return {
      providers: [
        { id: 'anthropic', label: 'Anthropic', modelsUrl: 'https://api.anthropic.com/v1/models' },
        { id: 'openai', label: 'OpenAI compatible', modelsUrl: 'https://api.openai.com/v1/models' },
        { id: 'ollama', label: 'Ollama', modelsUrl: `${process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434'}/api/tags` },
      ],
    };
  }

  envCheck(name: string) {
    const trimmed = name.trim();
    return { name: trimmed, present: Boolean(trimmed && process.env[trimmed]) };
  }

  listPublic(user: PublicUser | null) {
    const groups = this.listGroupsWithVariants(user ? '' : 'AND g.free = 1');
    return { groups: groups.map((group) => this.publicGroup(group)) };
  }

  listAdmin() {
    return { groups: this.listGroupsWithVariants('').map((group) => this.adminGroup(group)) };
  }

  createGroup(body: Record<string, unknown>) {
    const slug = safeSlug(String(body.slug ?? ''));
    const label = String(body.label ?? '').trim();
    if (!label) badRequest('label is required');
    const now = nowIso();
    const uid = crypto.randomUUID();
    const position = toInt(body.position, this.nextGroupPosition());
    try {
      this.db.run(
        `INSERT INTO ai_groups (uid, slug, label, role, color, free, position, api_key_env_var, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [uid, slug, label, String(body.role ?? ''), String(body.color ?? '#64748b'), body.free === true ? 1 : 0, position, String(body.api_key_env_var ?? ''), now, now],
      );
    } catch (error) {
      if (String(error).includes('UNIQUE')) conflict('AI group slug already exists');
      throw error;
    }
    return { group: this.adminGroup({ ...this.getGroup(uid), variants: [] }) };
  }

  patchGroup(uid: string, body: Record<string, unknown>) {
    const current = this.getGroup(uid);
    const patch = {
      slug: body.slug === undefined ? current.slug : safeSlug(String(body.slug)),
      label: body.label === undefined ? current.label : String(body.label).trim(),
      role: body.role === undefined ? current.role : String(body.role),
      color: body.color === undefined ? current.color : String(body.color),
      free: body.free === undefined ? current.free : body.free === true ? 1 : 0,
      position: body.position === undefined ? current.position : toInt(body.position, current.position),
      api_key_env_var: body.api_key_env_var === undefined ? current.api_key_env_var : String(body.api_key_env_var),
    };
    try {
      this.db.run(
        `UPDATE ai_groups SET slug = ?, label = ?, role = ?, color = ?, free = ?, position = ?, api_key_env_var = ?, updated_at = ? WHERE uid = ?`,
        [patch.slug, patch.label, patch.role, patch.color, patch.free, patch.position, patch.api_key_env_var, nowIso(), uid],
      );
    } catch (error) {
      if (String(error).includes('UNIQUE')) conflict('AI group slug already exists');
      throw error;
    }
    return { group: this.adminGroup({ ...this.getGroup(uid), variants: this.getVariants(uid) }) };
  }

  deleteGroup(uid: string): void {
    this.getGroup(uid);
    this.db.run('UPDATE ai_groups SET deleted_at = ?, updated_at = ? WHERE uid = ?', [nowIso(), nowIso(), uid]);
  }

  reorderGroups(uids: string[]): void {
    this.db.transaction(() => uids.forEach((uid, index) => this.db.run('UPDATE ai_groups SET position = ?, updated_at = ? WHERE uid = ?', [index + 1, nowIso(), uid])));
  }

  createVariant(groupUid: string, body: Record<string, unknown>) {
    this.getGroup(groupUid);
    const slug = safeSlug(String(body.slug ?? body.provider_model_id ?? ''));
    const modelId = String(body.provider_model_id ?? '').trim();
    if (!modelId) badRequest('provider_model_id is required');
    const now = nowIso();
    const uid = crypto.randomUUID();
    const isDefault = body.is_default === true ? 1 : 0;
    if (isDefault) this.clearDefaultVariant(groupUid);
    try {
      this.db.run(
        `INSERT INTO ai_variants (uid, group_uid, slug, provider_model_id, label, is_default, position, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [uid, groupUid, slug, modelId, String(body.label ?? modelId), isDefault, toInt(body.position, this.nextVariantPosition(groupUid)), now, now],
      );
    } catch (error) {
      if (String(error).includes('UNIQUE')) conflict('AI variant slug already exists for this group');
      throw error;
    }
    return { variant: this.adminVariant(this.getVariant(uid)) };
  }

  patchVariant(uid: string, body: Record<string, unknown>) {
    const current = this.getVariant(uid);
    if (body.is_default === true) this.clearDefaultVariant(current.group_uid);
    this.db.run(
      `UPDATE ai_variants SET slug = ?, provider_model_id = ?, label = ?, is_default = ?, position = ?, updated_at = ? WHERE uid = ?`,
      [
        body.slug === undefined ? current.slug : safeSlug(String(body.slug)),
        body.provider_model_id === undefined ? current.provider_model_id : String(body.provider_model_id),
        body.label === undefined ? current.label : String(body.label),
        body.is_default === undefined ? current.is_default : body.is_default === true ? 1 : 0,
        body.position === undefined ? current.position : toInt(body.position, current.position),
        nowIso(),
        uid,
      ],
    );
    return { variant: this.adminVariant(this.getVariant(uid)) };
  }

  deleteVariant(uid: string): void {
    this.getVariant(uid);
    this.db.run('UPDATE ai_variants SET deleted_at = ?, updated_at = ? WHERE uid = ?', [nowIso(), nowIso(), uid]);
  }

  reorderVariants(groupUid: string, uids: string[]): void {
    this.getGroup(groupUid);
    this.db.transaction(() => uids.forEach((uid, index) => this.db.run('UPDATE ai_variants SET position = ?, updated_at = ? WHERE uid = ? AND group_uid = ?', [index + 1, nowIso(), uid, groupUid])));
  }

  async importModels(groupUid: string, body: { providerId?: string; modelsUrl?: string; envVarName?: string }) {
    const group = this.getGroup(groupUid);
    const modelsUrl = body.modelsUrl?.trim();
    if (!modelsUrl) badRequest('modelsUrl is required');
    const envVarName = body.envVarName?.trim() ?? group.api_key_env_var;
    const apiKey = envVarName ? process.env[envVarName] : undefined;
    const headers: Record<string, string> = { 'content-type': 'application/json', 'anthropic-version': '2023-06-01' };
    if (apiKey) headers['x-api-key'] = apiKey;
    let payload: unknown;
    try {
      const response = await fetch(modelsUrl, { headers });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${await response.text().catch(() => '')}`);
      payload = await response.json();
    } catch (error) {
      throw new BadGatewayException({ error: `Failed to import models: ${error instanceof Error ? error.message : String(error)}` });
    }
    const models = this.mapModelPayload(payload);
    this.db.transaction(() => {
      if (envVarName) this.db.run('UPDATE ai_groups SET api_key_env_var = ?, updated_at = ? WHERE uid = ?', [envVarName, nowIso(), groupUid]);
      models.forEach((model, index) => this.upsertVariantFromModel(groupUid, model.id, model.label, index + 1));
    });
    return { group: this.adminGroup({ ...this.getGroup(groupUid), variants: this.getVariants(groupUid) }), imported: models.length, modelsUrl };
  }

  getGroup(uid: string): AiGroupRow {
    const row = this.db.get<AiGroupRow>('SELECT * FROM ai_groups WHERE uid = ?', [uid]);
    if (!row) notFound(`AI group "${uid}" not found`);
    return row;
  }

  getVariant(uid: string): AiVariantRow {
    const row = this.db.get<AiVariantRow>('SELECT * FROM ai_variants WHERE uid = ?', [uid]);
    if (!row) notFound(`AI variant "${uid}" not found`);
    return row;
  }

  getVariants(groupUid: string): AiVariantRow[] {
    return this.db.all<AiVariantRow>('SELECT * FROM ai_variants WHERE group_uid = ? AND deleted_at IS NULL ORDER BY position ASC, slug ASC', [groupUid]);
  }

  adminGroup(item: AiGroupRow & { variants: AiVariantRow[] }) {
    return { ...this.baseGroup(item), api_key_env_var: item.api_key_env_var, api_key_present: Boolean(item.api_key_env_var && process.env[item.api_key_env_var]), variants: item.variants.map((variant) => this.adminVariant(variant)) };
  }

  private publicGroup(item: AiGroupRow & { variants: AiVariantRow[] }) {
    return { ...this.baseGroup(item), variants: item.variants.map((variant) => ({ uid: variant.uid, slug: variant.slug, label: variant.label, is_default: boolFromDb(variant.is_default), created_at: variant.created_at, updated_at: variant.updated_at })) };
  }

  private baseGroup(item: AiGroupRow) {
    return { uid: item.uid, slug: item.slug, label: item.label, role: item.role, color: item.color, free: boolFromDb(item.free), position: Number(item.position), deleted_at: item.deleted_at, created_at: item.created_at, updated_at: item.updated_at };
  }

  private adminVariant(variant: AiVariantRow) {
    return { uid: variant.uid, group_uid: variant.group_uid, slug: variant.slug, provider_model_id: variant.provider_model_id, label: variant.label, is_default: boolFromDb(variant.is_default), position: Number(variant.position), deleted_at: variant.deleted_at, created_at: variant.created_at, updated_at: variant.updated_at };
  }

  private listGroupsWithVariants(extraWhere: string) {
    return this.db.all<AiGroupRow>(`SELECT * FROM ai_groups g WHERE g.deleted_at IS NULL ${extraWhere} ORDER BY g.position ASC, g.slug ASC`).map((group) => ({ ...group, variants: this.getVariants(group.uid) }));
  }

  private nextGroupPosition(): number {
    return Number(this.db.get<{ max: number | null }>('SELECT MAX(position) AS max FROM ai_groups')?.max ?? 0) + 1;
  }

  private nextVariantPosition(groupUid: string): number {
    return Number(this.db.get<{ max: number | null }>('SELECT MAX(position) AS max FROM ai_variants WHERE group_uid = ?', [groupUid])?.max ?? 0) + 1;
  }

  private clearDefaultVariant(groupUid: string): void {
    this.db.run('UPDATE ai_variants SET is_default = 0 WHERE group_uid = ?', [groupUid]);
  }

  private upsertVariantFromModel(groupUid: string, modelId: string, label: string, position: number): void {
    const slug = safeSlug(modelId);
    const now = nowIso();
    this.db.run(
      `INSERT INTO ai_variants (uid, group_uid, slug, provider_model_id, label, is_default, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(group_uid, slug) DO UPDATE SET provider_model_id = excluded.provider_model_id, label = excluded.label, deleted_at = NULL, updated_at = excluded.updated_at`,
      [crypto.randomUUID(), groupUid, slug, modelId, label, position === 1 ? 1 : 0, position, now, now],
    );
  }

  private mapModelPayload(payload: unknown): Array<{ id: string; label: string }> {
    const items = Array.isArray((payload as { data?: unknown[] }).data)
      ? (payload as { data: unknown[] }).data
      : Array.isArray((payload as { models?: unknown[] }).models)
        ? (payload as { models: unknown[] }).models
        : Array.isArray(payload)
          ? payload
          : [];
    return items
      .map((item) => {
        const record = item as Record<string, unknown>;
        const id = String(record.id ?? record.name ?? record.model ?? '').trim();
        const label = String(record.display_name ?? record.label ?? record.name ?? id).trim();
        return id ? { id, label } : null;
      })
      .filter((item): item is { id: string; label: string } => Boolean(item));
  }
}
