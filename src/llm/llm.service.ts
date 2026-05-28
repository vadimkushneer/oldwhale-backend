import crypto from 'node:crypto';
import { BadGatewayException, Injectable } from '@nestjs/common';
import { notFound } from '../common/http-error';
import { nowIso } from '../common/time';
import { SqliteService } from '../database/sqlite.service';
import { InMemoryJobRunnerService } from '../jobs/in-memory-job-runner.service';

interface LlmGroupRow { uid: string; api_key_env_var: string; models_list_request_url: string; created_at: string; updated_at: string }
interface LlmModelRow { uid: string; llm_group_uid: string; name: string; display_name: string | null; created_at: string; updated_at: string }

@Injectable()
export class LlmService {
  constructor(private readonly db: SqliteService, private readonly jobs: InMemoryJobRunnerService) {}

  createGroup(body: Record<string, unknown>) {
    const uid = String(body.uid ?? crypto.randomUUID());
    const now = nowIso();
    this.db.run('INSERT INTO llm_groups (uid, api_key_env_var, models_list_request_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [uid, String(body.apiKeyEnvVar ?? body.api_key_env_var ?? ''), String(body.modelsListRequestUrl ?? body.models_list_request_url ?? ''), now, now]);
    return this.serializeGroup(this.getGroupRow(uid));
  }

  listGroups() {
    return this.db.all<LlmGroupRow>('SELECT * FROM llm_groups ORDER BY uid ASC').map((row) => this.serializeGroup(row));
  }

  getGroup(uid: string) {
    return this.serializeGroup(this.getGroupRow(uid));
  }

  updateGroup(uid: string, body: Record<string, unknown>) {
    const current = this.getGroupRow(uid);
    this.db.run('UPDATE llm_groups SET api_key_env_var = ?, models_list_request_url = ?, updated_at = ? WHERE uid = ?', [String(body.apiKeyEnvVar ?? body.api_key_env_var ?? current.api_key_env_var), String(body.modelsListRequestUrl ?? body.models_list_request_url ?? current.models_list_request_url), nowIso(), uid]);
    return this.serializeGroup(this.getGroupRow(uid));
  }

  deleteGroup(uid: string): void {
    this.getGroupRow(uid);
    this.db.run('DELETE FROM llm_groups WHERE uid = ?', [uid]);
  }

  refreshApiKey(uid: string) {
    return this.getGroup(uid);
  }

  fetchModels(uid: string) {
    const group = this.getGroupRow(uid);
    const job = this.jobs.enqueue('fetch-llm-models-list', async () => this.importLlmModels(group), { attempts: 3, backoffMs: 1000 });
    return { jobId: job.id, jobName: 'fetch-llm-models-list', llmGroupUid: uid, queueName: 'fetch-llm-models' };
  }

  createModel(body: Record<string, unknown>) {
    const uid = String(body.uid ?? crypto.randomUUID());
    const now = nowIso();
    this.db.run('INSERT INTO llm_models (uid, llm_group_uid, name, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [uid, String(body.llmGroupUid ?? body.llm_group_uid), String(body.name ?? ''), body.displayName === undefined ? body.display_name as string | null ?? null : String(body.displayName), now, now]);
    return this.getModel(uid);
  }

  listModels() {
    return this.db.all<LlmModelRow>('SELECT * FROM llm_models ORDER BY name ASC').map((row) => this.serializeModel(row));
  }

  getModel(uid: string) {
    const row = this.db.get<LlmModelRow>('SELECT * FROM llm_models WHERE uid = ?', [uid]);
    if (!row) notFound(`llm-model with uid "${uid}" not found`);
    return this.serializeModel(row);
  }

  updateModel(uid: string, body: Record<string, unknown>) {
    const current = this.db.get<LlmModelRow>('SELECT * FROM llm_models WHERE uid = ?', [uid]);
    if (!current) notFound(`llm-model with uid "${uid}" not found`);
    this.db.run('UPDATE llm_models SET llm_group_uid = ?, name = ?, display_name = ?, updated_at = ? WHERE uid = ?', [String(body.llmGroupUid ?? body.llm_group_uid ?? current.llm_group_uid), String(body.name ?? current.name), body.displayName === undefined ? current.display_name : String(body.displayName), nowIso(), uid]);
    return this.getModel(uid);
  }

  deleteModel(uid: string): void {
    this.getModel(uid);
    this.db.run('DELETE FROM llm_models WHERE uid = ?', [uid]);
  }

  private getGroupRow(uid: string): LlmGroupRow {
    const row = this.db.get<LlmGroupRow>('SELECT * FROM llm_groups WHERE uid = ?', [uid]);
    if (!row) notFound(`llm-group with uid "${uid}" not found`);
    return row;
  }

  private async importLlmModels(group: LlmGroupRow): Promise<void> {
    const headers: Record<string, string> = { 'content-type': 'application/json', 'anthropic-version': '2023-06-01' };
    const apiKey = group.api_key_env_var ? process.env[group.api_key_env_var] : undefined;
    if (apiKey) headers['x-api-key'] = apiKey;
    const response = await fetch(group.models_list_request_url, { headers });
    if (!response.ok) throw new BadGatewayException(`Failed to fetch LLM models list: ${response.status} ${response.statusText}`);
    const payload = await response.json();
    const items = Array.isArray((payload as { data?: unknown[] }).data) ? (payload as { data: unknown[] }).data : [];
    const now = nowIso();
    this.db.transaction(() => {
      for (const item of items) {
        const record = item as Record<string, unknown>;
        const name = String(record.id ?? record.name ?? '').trim();
        if (!name) continue;
        const displayName = String(record.display_name ?? record.name ?? name);
        this.db.run(
          `INSERT INTO llm_models (uid, llm_group_uid, name, display_name, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(llm_group_uid, name) DO UPDATE SET display_name = excluded.display_name, updated_at = excluded.updated_at`,
          [crypto.randomUUID(), group.uid, name, displayName, now, now],
        );
      }
    });
  }

  private serializeGroup(row: LlmGroupRow) {
    return { uid: row.uid, apiKeyEnvVar: row.api_key_env_var, api_key_env_var: row.api_key_env_var, modelsListRequestUrl: row.models_list_request_url, models_list_request_url: row.models_list_request_url, apiKey: row.api_key_env_var ? process.env[row.api_key_env_var] : undefined, llmModels: this.db.all<LlmModelRow>('SELECT * FROM llm_models WHERE llm_group_uid = ? ORDER BY name ASC', [row.uid]).map((model) => this.serializeModel(model)), created_at: row.created_at, updated_at: row.updated_at };
  }

  private serializeModel(row: LlmModelRow) {
    return { uid: row.uid, llmGroupUid: row.llm_group_uid, llm_group_uid: row.llm_group_uid, name: row.name, displayName: row.display_name, display_name: row.display_name, created_at: row.created_at, updated_at: row.updated_at };
  }
}
