import crypto from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { badGateway, badRequest, notFound, serviceUnavailable } from '../common/http-error';
import { nowIso, toInt } from '../common/time';
import {
  readFrontendBaseUrl,
  readPublicApiBaseUrl,
  readVtbCallbackChecksumKey,
  readVtbCurrency,
  readVtbLanguage,
  readVtbMinorUnitsPerCredit,
  readVtbReturnPath,
  readVtbSessionTimeoutSecs,
} from '../config/env';
import { SqliteService, type SqlParam } from '../database/sqlite.service';
import { UsersService } from '../users/users.service';
import type { PublicUser } from '../users/users.types';
import { PaymentEventsService } from './payment-events.service';
import { redactSecrets } from './redact';
import type { PaymentRow, PaymentStatus, PublicPayment } from './payments.types';
import type { VtbOrderStatusResult, VtbRegisterResult } from './vtb-gateway.service';
import { VtbGatewayService } from './vtb-gateway.service';

/** Smallest / largest single top-up in OWK (guards against typos and overflow). */
const MIN_TOPUP_CREDITS = 1;
const MAX_TOPUP_CREDITS = 1_000_000;

/** Source label recorded on credit grants for forensic attribution. */
type CreditSource = 'return-sync' | 'callback';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger('Payments');

  constructor(
    private readonly db: SqliteService,
    private readonly users: UsersService,
    private readonly gateway: VtbGatewayService,
    private readonly events: PaymentEventsService,
  ) {}

  /**
   * Registers a new top-up order on the gateway and returns the hosted payment
   * page URL. The browser must then be redirected to `formUrl`.
   */
  async createPayment(user: PublicUser, creditsRequested: unknown): Promise<PublicPayment> {
    const credits = this.validateCredits(creditsRequested);

    if (!this.gateway.isConfigured()) {
      this.logger.error(
        `payment create rejected: VTB gateway not configured (set VTB_API_USERNAME/VTB_API_PASSWORD or VTB_API_TOKEN). user=${user.uid}`,
      );
      serviceUnavailable('Оплата временно недоступна. Платёжный шлюз не настроен.');
    }

    const minorPerCredit = readVtbMinorUnitsPerCredit();
    const amountMinor = credits * minorPerCredit;
    const currency = readVtbCurrency();
    const now = nowIso();
    const uid = crypto.randomUUID();
    const orderNumber = this.generateOrderNumber();
    const returnUrl = this.buildReturnUrl(uid);
    const failUrl = returnUrl;
    const expiresAt = new Date(Date.now() + readVtbSessionTimeoutSecs() * 1000).toISOString();

    this.insertRow({
      uid,
      orderNumber,
      userUid: user.uid,
      credits,
      amountMinor,
      currency,
      returnUrl,
      failUrl,
      expiresAt,
      now,
    });

    this.events.record(uid, 'payment.created', `created top-up of ${credits} OWK (${amountMinor} minor, cur=${currency}) for user ${user.uid}`, {
      credits,
      amountMinor,
      currency,
      orderNumber,
    });

    const dynamicCallbackUrl = this.buildCallbackUrl();

    let result: VtbRegisterResult;
    try {
      result = await this.gateway.register(uid, {
        orderNumber,
        amount: amountMinor,
        currency,
        returnUrl,
        failUrl,
        description: `OldWhale ${credits} OWK`,
        language: readVtbLanguage(),
        email: user.email,
        clientId: user.uid,
        dynamicCallbackUrl,
        sessionTimeoutSecs: readVtbSessionTimeoutSecs(),
      });
    } catch (error) {
      this.markFailed(uid, 'GATEWAY_UNREACHABLE', String(error));
      this.events.record(uid, 'register.transport_error', 'register.do did not complete', undefined, 'error');
      badGateway('Не удалось связаться с платёжным шлюзом. Попробуйте позже.');
    }

    if (!result.ok || !result.formUrl) {
      this.db.run(
        `UPDATE payments SET status='failed', gateway_order_id=?, error_code=?, error_message=?, raw_last_gateway_response=?, updated_at=? WHERE uid=?`,
        [result.orderId ?? null, result.errorCode ?? null, result.errorMessage ?? null, safeStringify(result.raw), nowIso(), uid],
      );
      this.events.record(
        uid,
        'register.failed',
        `register.do failed: errorCode=${result.errorCode ?? '?'} ${result.errorMessage ?? ''}`,
        { httpStatus: result.httpStatus, errorCode: result.errorCode },
        'error',
      );
      badGateway(result.errorMessage || 'Платёжный шлюз отклонил регистрацию заказа.');
    }

    this.db.run(
      `UPDATE payments SET status='registered', gateway_order_id=?, form_url=?, error_code=NULL, error_message=NULL, raw_last_gateway_response=?, updated_at=? WHERE uid=?`,
      [result.orderId ?? null, result.formUrl, safeStringify(result.raw), nowIso(), uid],
    );
    this.events.record(uid, 'register.ok', `registered; gatewayOrderId=${result.orderId}`, {
      gatewayOrderId: result.orderId,
      formUrl: result.formUrl,
    });

    return this.serialize(this.requireRow(uid));
  }

  /**
   * Re-checks the authoritative order status on the gateway and, when paid,
   * grants credits exactly once. Used by the SPA payment-return page.
   */
  async syncPayment(user: PublicUser, uid: string): Promise<{ payment: PublicPayment; user: PublicUser }> {
    const row = this.requireUserRow(user.uid, uid);

    if (row.credited_at) {
      this.events.record(uid, 'sync.skip', 'already credited; returning cached state', undefined, 'info');
      return { payment: this.serialize(row), user: this.refreshUser(user.uid) };
    }

    if (!this.gateway.isConfigured()) {
      serviceUnavailable('Оплата временно недоступна. Платёжный шлюз не настроен.');
    }

    this.events.record(uid, 'sync.requested', `checking gateway status (source=return-sync) for user ${user.uid}`);
    const status = await this.gateway.getOrderStatus(uid, {
      orderId: row.gateway_order_id ?? undefined,
      orderNumber: row.order_number,
      language: readVtbLanguage(),
    });
    this.applyStatus(row, status, 'return-sync');

    return { payment: this.serialize(this.requireRow(uid)), user: this.refreshUser(user.uid) };
  }

  /**
   * Handles an asynchronous gateway callback. The callback is only a trigger:
   * the credit decision is always re-derived from getOrderStatusExtended, so a
   * forged callback cannot grant credits even if checksum verification is off.
   */
  async handleCallback(params: Record<string, unknown>): Promise<void> {
    const flat = flattenParams(params);
    const orderNumber = typeof flat.orderNumber === 'string' ? flat.orderNumber : undefined;
    const mdOrder = typeof flat.mdOrder === 'string' ? flat.mdOrder : undefined;
    const operation = typeof flat.operation === 'string' ? flat.operation : undefined;
    const status = typeof flat.status === 'string' ? flat.status : undefined;

    const row = this.findRowForCallback(orderNumber, mdOrder);
    if (!row) {
      this.logger.warn(
        `VTB callback for unknown order (orderNumber=${orderNumber ?? '?'}, mdOrder=${mdOrder ?? '?'}, operation=${operation ?? '?'}, status=${status ?? '?'}) — ignored`,
      );
      return;
    }

    this.events.record(row.uid, 'callback.received', `operation=${operation ?? '?'} status=${status ?? '?'}`, {
      params: redactSecrets(flat),
    });

    if (!this.verifyChecksum(row.uid, flat)) {
      // Verification failed — do not act on it. (verifyChecksum logs the reason.)
      return;
    }

    if (row.credited_at) {
      this.events.record(row.uid, 'callback.skip', 'already credited; acknowledging', undefined, 'info');
      return;
    }

    if (!this.gateway.isConfigured()) {
      this.events.record(row.uid, 'callback.no_gateway', 'cannot verify: gateway not configured', undefined, 'warn');
      return;
    }

    const orderStatus = await this.gateway.getOrderStatus(row.uid, {
      orderId: row.gateway_order_id ?? undefined,
      orderNumber: row.order_number,
      language: readVtbLanguage(),
    });
    this.applyStatus(row, orderStatus, 'callback');
  }

  listForUser(user: PublicUser): PublicPayment[] {
    return this.db
      .all<PaymentRow>('SELECT * FROM payments WHERE user_uid = ? ORDER BY id DESC LIMIT 100', [user.uid])
      .map((row) => this.serialize(row));
  }

  getForUser(user: PublicUser, uid: string): PublicPayment {
    return this.serialize(this.requireUserRow(user.uid, uid));
  }

  /** Admin: paginated list of all payments for support/forensics. */
  listAll(query: Record<string, unknown>): { items: PublicPayment[]; total: number } {
    const limit = Math.min(200, Math.max(1, toInt(query.limit, 50)));
    const offset = Math.max(0, toInt(query.offset, 0));
    const clauses: string[] = [];
    const sqlParams: SqlParam[] = [];
    if (typeof query.status === 'string' && query.status.trim()) {
      clauses.push('status = ?');
      sqlParams.push(query.status.trim());
    }
    if (typeof query.user_uid === 'string' && query.user_uid.trim()) {
      clauses.push('user_uid = ?');
      sqlParams.push(query.user_uid.trim());
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const items = this.db.all<PaymentRow>(
      `SELECT * FROM payments ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...sqlParams, limit, offset],
    );
    const total = this.db.get<{ total: number }>(`SELECT COUNT(*) AS total FROM payments ${where}`, sqlParams)?.total ?? 0;
    return { items: items.map((row) => this.serialize(row)), total };
  }

  /** Admin: full audit trail for one payment. */
  eventsFor(uid: string): { payment: PublicPayment; events: Array<Record<string, unknown>> } {
    const row = this.requireRow(uid);
    return { payment: this.serialize(row), events: this.events.list(uid) };
  }

  /* --------------------------- internals --------------------------- */

  private applyStatus(row: PaymentRow, status: VtbOrderStatusResult, source: CreditSource): void {
    const rawJson = safeStringify(status.raw);
    const now = nowIso();

    if (!status.ok) {
      this.db.run(
        `UPDATE payments SET order_status=?, action_code=?, error_code=?, error_message=?, raw_last_gateway_response=?, updated_at=? WHERE uid=? AND credited_at IS NULL`,
        [status.orderStatus ?? row.order_status ?? null, status.actionCode ?? null, status.errorCode ?? null, status.errorMessage ?? null, rawJson, now, row.uid],
      );
      this.events.record(
        row.uid,
        'status.request_error',
        `getOrderStatusExtended errorCode=${status.errorCode ?? '?'} ${status.errorMessage ?? ''} (source=${source})`,
        undefined,
        'warn',
      );
      return;
    }

    const orderStatus = status.orderStatus;
    if (orderStatus === 1 || orderStatus === 2) {
      this.grantCredits(row, source, status, rawJson);
      return;
    }

    const next: PaymentStatus =
      orderStatus === 3 ? 'canceled' : orderStatus === 4 ? 'refunded' : orderStatus === 6 ? 'failed' : 'pending';
    this.db.run(
      `UPDATE payments SET status=?, order_status=?, action_code=?, error_code=?, error_message=?, raw_last_gateway_response=?, updated_at=? WHERE uid=? AND credited_at IS NULL`,
      [next, orderStatus ?? null, status.actionCode ?? null, status.errorCode ?? null, status.errorMessage ?? null, rawJson, now, row.uid],
    );
    this.events.record(row.uid, 'status.updated', `orderStatus=${orderStatus ?? '?'} → ${next} (source=${source})`, {
      orderStatus,
      actionCode: status.actionCode,
      actionCodeDescription: status.actionCodeDescription,
    });
  }

  /** Idempotent: a single conditional UPDATE elects the one caller that credits. */
  private grantCredits(row: PaymentRow, source: CreditSource, status: VtbOrderStatusResult, rawJson: string): void {
    this.db.transaction(() => {
      const ts = nowIso();
      const res = this.db.run(
        `UPDATE payments SET status='paid', credited_at=?, order_status=?, action_code=?, error_code=NULL, error_message=NULL, raw_last_gateway_response=?, updated_at=? WHERE uid=? AND credited_at IS NULL`,
        [ts, status.orderStatus ?? null, status.actionCode ?? null, rawJson, ts, row.uid],
      );
      if (Number(res.changes) === 0) {
        this.events.record(row.uid, 'credit.skipped', `already credited; source=${source}`, undefined, 'info');
        return;
      }
      this.users.addCredits(row.user_uid, row.credits);
      this.events.record(row.uid, 'credit.granted', `+${row.credits} OWK → user ${row.user_uid} (source=${source})`, {
        credits: row.credits,
        orderStatus: status.orderStatus,
      });
    });
  }

  /**
   * Verifies a checksum callback when a symmetric key is configured. Returns
   * true (proceed) when the checksum is valid OR when verification is not
   * applicable (no key configured / no checksum sent) — in that case the
   * authoritative getOrderStatusExtended re-check still protects us.
   */
  private verifyChecksum(paymentUid: string, flat: Record<string, string>): boolean {
    const key = readVtbCallbackChecksumKey();
    const checksum = flat.checksum;
    if (!key) {
      this.events.record(paymentUid, 'callback.checksum.skipped', 'no shared key configured; relying on gateway re-check', undefined, 'info');
      return true;
    }
    if (!checksum) {
      this.events.record(paymentUid, 'callback.checksum.absent', 'key configured but callback had no checksum; relying on gateway re-check', undefined, 'warn');
      return true;
    }
    const toSign = Object.entries(flat)
      .filter(([k]) => k !== 'checksum' && k !== 'sign_alias')
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${k};${v};`)
      .join('');
    const expected = crypto.createHmac('sha256', key).update(toSign, 'utf8').digest('hex').toUpperCase();
    const got = checksum.toUpperCase();
    const valid = expected.length === got.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(got));
    if (!valid) {
      this.events.record(paymentUid, 'callback.checksum.fail', 'checksum mismatch — callback ignored', undefined, 'error');
      return false;
    }
    this.events.record(paymentUid, 'callback.checksum.ok', 'checksum verified', undefined, 'info');
    return true;
  }

  private validateCredits(value: unknown): number {
    const credits = Math.trunc(Number(value));
    if (!Number.isFinite(credits) || credits < MIN_TOPUP_CREDITS) {
      badRequest(`credits must be an integer >= ${MIN_TOPUP_CREDITS}`);
    }
    if (credits > MAX_TOPUP_CREDITS) {
      badRequest(`credits must not exceed ${MAX_TOPUP_CREDITS}`);
    }
    return credits;
  }

  private generateOrderNumber(): string {
    // 'ow' + 28 hex chars = 30 chars, within the gateway's 36-char limit.
    return `ow${crypto.randomBytes(14).toString('hex')}`;
  }

  private buildReturnUrl(uid: string): string {
    const base = readFrontendBaseUrl();
    const path = readVtbReturnPath().replace(/\/+$/, '');
    return `${base}${path}/${uid}`;
  }

  private buildCallbackUrl(): string | undefined {
    const base = readPublicApiBaseUrl();
    if (!base) return undefined;
    return `${base}/api/payments/vtb/callback`;
  }

  private insertRow(input: {
    uid: string;
    orderNumber: string;
    userUid: string;
    credits: number;
    amountMinor: number;
    currency: string;
    returnUrl: string;
    failUrl: string;
    expiresAt: string;
    now: string;
  }): void {
    this.db.run(
      `INSERT INTO payments (uid, order_number, user_uid, credits, amount_minor, currency, status, return_url, fail_url, expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'created', ?, ?, ?, ?, ?)`,
      [input.uid, input.orderNumber, input.userUid, input.credits, input.amountMinor, input.currency, input.returnUrl, input.failUrl, input.expiresAt, input.now, input.now],
    );
  }

  private markFailed(uid: string, code: string, message: string): void {
    this.db.run('UPDATE payments SET status=\'failed\', error_code=?, error_message=?, updated_at=? WHERE uid=?', [code, message.slice(0, 500), nowIso(), uid]);
  }

  private findRowForCallback(orderNumber?: string, mdOrder?: string): PaymentRow | undefined {
    if (orderNumber) {
      const byNumber = this.db.get<PaymentRow>('SELECT * FROM payments WHERE order_number = ?', [orderNumber]);
      if (byNumber) return byNumber;
    }
    if (mdOrder) {
      return this.db.get<PaymentRow>('SELECT * FROM payments WHERE gateway_order_id = ?', [mdOrder]);
    }
    return undefined;
  }

  private requireRow(uid: string): PaymentRow {
    const row = this.db.get<PaymentRow>('SELECT * FROM payments WHERE uid = ?', [uid]);
    if (!row) notFound(`payment "${uid}" not found`);
    return row;
  }

  private requireUserRow(userUid: string, uid: string): PaymentRow {
    const row = this.db.get<PaymentRow>('SELECT * FROM payments WHERE uid = ? AND user_uid = ?', [uid, userUid]);
    if (!row) notFound(`payment "${uid}" not found`);
    return row;
  }

  private refreshUser(uid: string): PublicUser {
    const user = this.users.findByUid(uid);
    if (!user) notFound('user not found');
    return user;
  }

  private serialize(row: PaymentRow): PublicPayment {
    return {
      uid: row.uid,
      orderNumber: row.order_number,
      credits: Number(row.credits),
      amountMinor: Number(row.amount_minor),
      currency: row.currency,
      status: row.status,
      gatewayOrderId: row.gateway_order_id,
      formUrl: row.form_url,
      orderStatus: row.order_status === null ? null : Number(row.order_status),
      actionCode: row.action_code,
      errorCode: row.error_code,
      errorMessage: row.error_message,
      creditedAt: row.credited_at,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '"[unserializable]"';
  }
}

/** Callbacks arrive as query (GET) or form (POST); values may be string arrays. */
function flattenParams(params: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) out[key] = value.length ? String(value[0]) : '';
    else if (value !== undefined && value !== null) out[key] = String(value);
  }
  return out;
}
