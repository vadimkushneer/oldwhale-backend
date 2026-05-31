import crypto from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { badRequest } from '../common/http-error';
import { nowIso } from '../common/time';
import { readFrontendBaseUrl, readJwtSecret, readPasswordResetTtlSeconds } from '../config/env';
import { SqliteService } from '../database/sqlite.service';
import { UsersService } from '../users/users.service';
import { MailService } from './mail.service';

type PasswordResetTokenRow = {
  uid: string;
  user_uid: string;
  email: string;
  token_hash: string;
  expires_at: string;
  used_at: string | null;
};

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);
  private readonly ttlSeconds = readPasswordResetTtlSeconds();
  private readonly hashSecret = readJwtSecret();

  constructor(
    private readonly db: SqliteService,
    private readonly users: UsersService,
    private readonly mail: MailService,
  ) {}

  async requestReset(input: { email?: string; login?: string; username?: string }): Promise<{ ok: true; expiresInSeconds: number }> {
    const identifier = (input.email ?? input.login ?? input.username ?? '').trim();
    if (!identifier) badRequest('Email or username is required');

    this.logger.log(`Password reset requested for ${this.maskIdentifier(identifier)}`);
    const row = this.users.findRowByUsernameOrEmail(identifier);
    const now = nowIso();
    this.deleteExpired(now);

    // Keep the response generic so reset requests cannot enumerate accounts.
    if (!row) {
      this.logger.warn(`Password reset skipped: no account matched ${this.maskIdentifier(identifier)}`);
      return { ok: true, expiresInSeconds: this.ttlSeconds };
    }
    if (row.disabled) {
      this.logger.warn(`Password reset skipped: account is disabled for ${this.maskIdentifier(row.email)}`);
      return { ok: true, expiresInSeconds: this.ttlSeconds };
    }

    const email = row.email.trim().toLowerCase();
    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = this.isoAfter(this.ttlSeconds);
    this.db.run('UPDATE password_reset_tokens SET used_at = ?, updated_at = ? WHERE user_uid = ? AND used_at IS NULL', [
      now,
      now,
      row.uid,
    ]);
    this.db.run(
      `INSERT INTO password_reset_tokens (uid, user_uid, email, token_hash, expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [crypto.randomUUID(), row.uid, email, this.hashValue(email, token), expiresAt, now, now],
    );

    const resetUrl = this.buildResetUrl(email, token);
    this.logger.log(`Password reset token stored for ${this.maskIdentifier(email)}; expiresAt=${expiresAt}`);
    await this.mail.sendPasswordResetLink(email, resetUrl, this.ttlSeconds);
    this.logger.log(`Password reset delivery step completed for ${this.maskIdentifier(email)}`);
    return { ok: true, expiresInSeconds: this.ttlSeconds };
  }

  completeReset(input: { email?: string; token?: string; password?: string }): { ok: true } {
    const email = this.normalizeEmail(input.email);
    const token = (input.token ?? '').trim();
    const password = input.password ?? '';
    if (!token) badRequest('Password reset token is required');
    if (password.length < 4) badRequest('Password must be at least 4 characters');

    const now = nowIso();
    this.deleteExpired(now);
    const row = this.db.get<PasswordResetTokenRow>(
      `SELECT * FROM password_reset_tokens
       WHERE email = ? AND token_hash = ? AND used_at IS NULL
       ORDER BY created_at DESC
       LIMIT 1`,
      [email, this.hashValue(email, token)],
    );
    if (!row || row.expires_at <= now) badRequest('Invalid or expired password reset link');

    this.db.transaction(() => {
      const user = this.users.findRowByUid(row.user_uid);
      if (!user || user.disabled) badRequest('Invalid or expired password reset link');

      const result = this.db.run('UPDATE password_reset_tokens SET used_at = ?, updated_at = ? WHERE uid = ? AND used_at IS NULL', [
        now,
        now,
        row.uid,
      ]);
      if (Number(result.changes) === 0) badRequest('Invalid or expired password reset link');

      this.users.updatePassword(row.user_uid, password);
      this.db.run('UPDATE password_reset_tokens SET used_at = ?, updated_at = ? WHERE user_uid = ? AND used_at IS NULL', [
        now,
        now,
        row.user_uid,
      ]);
    });

    return { ok: true };
  }

  private maskIdentifier(value: string): string {
    const trimmed = value.trim().toLowerCase();
    const [local, domain] = trimmed.split('@');
    if (!domain) return trimmed.length <= 2 ? '**' : `${trimmed.slice(0, 2)}***`;
    return `${local.slice(0, 2)}***@${domain}`;
  }

  private normalizeEmail(email: string | undefined): string {
    const normalized = (email ?? '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) badRequest('Email is invalid');
    return normalized;
  }

  private hashValue(email: string, value: string): string {
    return crypto.createHmac('sha256', this.hashSecret).update(`${email}:${value}`).digest('hex');
  }

  private buildResetUrl(email: string, token: string): string {
    const url = new URL(`${readFrontendBaseUrl()}/reset-password`);
    url.searchParams.set('email', email);
    url.searchParams.set('token', token);
    return url.toString();
  }

  private isoAfter(seconds: number): string {
    return new Date(Date.now() + seconds * 1000).toISOString();
  }

  private deleteExpired(now: string): void {
    this.db.run('DELETE FROM password_reset_tokens WHERE expires_at <= ? OR (used_at IS NOT NULL AND used_at <= ?)', [now, now]);
  }
}
