import crypto from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { badRequest, conflict } from '../common/http-error';
import { nowIso } from '../common/time';
import { readJwtSecret, readRegistrationOtpTtlSeconds, readRegistrationSetupTtlSeconds } from '../config/env';
import { SqliteService } from '../database/sqlite.service';
import { UsersService } from '../users/users.service';
import { MailService } from './mail.service';

type PendingRegistrationRow = {
  uid: string;
  email: string;
  otp_hash: string;
  otp_expires_at: string;
  attempts: number;
  setup_token_hash: string | null;
  setup_token_expires_at: string | null;
  verified_at: string | null;
};

@Injectable()
export class RegistrationOtpService {
  private readonly otpTtlSeconds = readRegistrationOtpTtlSeconds();
  private readonly setupTtlSeconds = readRegistrationSetupTtlSeconds();
  private readonly maxAttempts = 5;
  private readonly hashSecret = readJwtSecret();

  constructor(
    private readonly db: SqliteService,
    private readonly users: UsersService,
    private readonly mail: MailService,
  ) {}

  async requestOtp(input: { email?: string }): Promise<{ ok: true; expiresInSeconds: number }> {
    const email = this.normalizeEmail(input.email);
    if (this.users.findRowByEmail(email)) conflict('Email already exists');

    const otp = this.generateOtp();
    const now = nowIso();
    const expiresAt = this.isoAfter(this.otpTtlSeconds);
    this.deleteExpired(now);
    this.db.run(
      `INSERT INTO pending_registrations (uid, email, otp_hash, otp_expires_at, attempts, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)
       ON CONFLICT(email) DO UPDATE SET
         uid = excluded.uid,
         otp_hash = excluded.otp_hash,
         otp_expires_at = excluded.otp_expires_at,
         attempts = 0,
         setup_token_hash = NULL,
         setup_token_expires_at = NULL,
         verified_at = NULL,
         updated_at = excluded.updated_at`,
      [crypto.randomUUID(), email, this.hashValue(email, otp), expiresAt, now, now],
    );

    await this.mail.sendRegistrationOtp(email, otp, this.otpTtlSeconds);
    return { ok: true, expiresInSeconds: this.otpTtlSeconds };
  }

  verifyOtp(input: { email?: string; otp?: string }): { setupToken: string; expiresInSeconds: number } {
    const email = this.normalizeEmail(input.email);
    const otp = (input.otp ?? '').trim();
    if (!/^\d{6}$/.test(otp)) badRequest('Registration code must contain 6 digits');

    const row = this.findPending(email);
    const now = nowIso();
    if (!row || row.otp_expires_at <= now) badRequest('Invalid or expired registration code');
    if (row.attempts >= this.maxAttempts) badRequest('Too many invalid registration code attempts');

    if (!this.equalHash(row.otp_hash, this.hashValue(email, otp))) {
      this.db.run('UPDATE pending_registrations SET attempts = attempts + 1, updated_at = ? WHERE email = ?', [now, email]);
      badRequest('Invalid or expired registration code');
    }

    const setupToken = crypto.randomBytes(32).toString('base64url');
    this.db.run(
      `UPDATE pending_registrations
       SET setup_token_hash = ?, setup_token_expires_at = ?, verified_at = ?, updated_at = ?
       WHERE email = ?`,
      [this.hashValue(email, setupToken), this.isoAfter(this.setupTtlSeconds), now, now, email],
    );
    return { setupToken, expiresInSeconds: this.setupTtlSeconds };
  }

  consumeSetupToken(input: { email?: string; setupToken?: string }): string {
    const email = this.normalizeEmail(input.email);
    const setupToken = (input.setupToken ?? '').trim();
    if (!setupToken) badRequest('Registration setup token is required');

    const row = this.findPending(email);
    const now = nowIso();
    if (!row?.verified_at || !row.setup_token_hash || !row.setup_token_expires_at || row.setup_token_expires_at <= now) {
      badRequest('Registration verification expired');
    }
    if (!this.equalHash(row.setup_token_hash, this.hashValue(email, setupToken))) {
      badRequest('Registration verification expired');
    }

    return email;
  }

  deletePending(email: string): void {
    this.db.run('DELETE FROM pending_registrations WHERE email = ?', [email.trim().toLowerCase()]);
  }

  private normalizeEmail(email: string | undefined): string {
    const normalized = (email ?? '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) badRequest('Email is invalid');
    return normalized;
  }

  private generateOtp(): string {
    return String(crypto.randomInt(100000, 1000000));
  }

  private hashValue(email: string, value: string): string {
    return crypto.createHmac('sha256', this.hashSecret).update(`${email}:${value}`).digest('hex');
  }

  private equalHash(left: string, right: string): boolean {
    const a = Buffer.from(left, 'hex');
    const b = Buffer.from(right, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  private isoAfter(seconds: number): string {
    return new Date(Date.now() + seconds * 1000).toISOString();
  }

  private findPending(email: string): PendingRegistrationRow | undefined {
    return this.db.get<PendingRegistrationRow>('SELECT * FROM pending_registrations WHERE email = ?', [email]);
  }

  private deleteExpired(now: string): void {
    this.db.run(
      `DELETE FROM pending_registrations
       WHERE otp_expires_at <= ?
         AND (setup_token_expires_at IS NULL OR setup_token_expires_at <= ?)`,
      [now, now],
    );
  }
}
