import crypto from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';

export interface JobOptions {
  attempts?: number;
  backoffMs?: number;
}

export interface JobRecord {
  id: string;
  name: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  attempts: number;
  error?: string;
  created_at: string;
  updated_at: string;
}

@Injectable()
export class InMemoryJobRunnerService {
  private readonly logger = new Logger(InMemoryJobRunnerService.name);
  private readonly history = new Map<string, JobRecord>();
  private chain = Promise.resolve();

  enqueue<T>(name: string, task: () => Promise<T>, options: JobOptions = {}): JobRecord {
    const now = new Date().toISOString();
    const job: JobRecord = { id: crypto.randomUUID(), name, status: 'queued', attempts: 0, created_at: now, updated_at: now };
    this.history.set(job.id, job);
    this.trimHistory();
    this.chain = this.chain.then(() => this.runJob(job, task, options)).catch((error: unknown) => {
      this.logger.error(`Job chain recovered: ${error instanceof Error ? error.message : String(error)}`);
    });
    return job;
  }

  get(id: string): JobRecord | undefined {
    return this.history.get(id);
  }

  private async runJob<T>(job: JobRecord, task: () => Promise<T>, options: JobOptions): Promise<void> {
    const maxAttempts = Math.max(1, options.attempts ?? 1);
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      job.status = 'running';
      job.attempts = attempt;
      job.updated_at = new Date().toISOString();
      try {
        await task();
        job.status = 'completed';
        job.updated_at = new Date().toISOString();
        return;
      } catch (error) {
        job.error = error instanceof Error ? error.message : String(error);
        if (attempt < maxAttempts) await new Promise((resolve) => setTimeout(resolve, (options.backoffMs ?? 500) * attempt));
      }
    }
    job.status = 'failed';
    job.updated_at = new Date().toISOString();
    this.logger.warn(`Job ${job.name}/${job.id} failed: ${job.error ?? 'unknown error'}`);
  }

  private trimHistory(): void {
    if (this.history.size <= 500) return;
    const first = this.history.keys().next().value as string | undefined;
    if (first) this.history.delete(first);
  }
}
