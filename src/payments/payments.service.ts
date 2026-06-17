import crypto from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { badGateway, badRequest, notFound, serviceUnavailable } from '../common/http-error';
import { nowIso } from '../common/time';
import {
  isVtbConfigured,
  readApiPublicBaseUrl,
  readFrontendBaseUrl,
  readVtbCallbackSecret,
} from '../config/env';
import { SqliteService } from '../database/sqlite.service';
import { UsersService } from '../users/users.service';
import type { PublicUser } from '../users/users.types';
import type {
  PaymentCreateResponse,
  PaymentPublic,
  PaymentRow,
  PaymentStatus,
  PaymentSyncResponse,
} from './payments.types';
import {
  isVtbGatewaySuccess,
  isVtbOrderPaid,
  VtbGatewayService,
  type VtbOrderStatus,
} from './vtb-gateway.service';

const MAX_TOPUP_CREDITS = 100_000;
const KZT_CURRENCY = '398';
const SESSION_TIMEOUT_SECS = 1200;

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly db: SqliteService,
    private readonly users: UsersService,
    private readonly vtb: VtbGatewayService,
  ) {}

  async createPayment(userUid: string, credits: number): Promise<PaymentCreateResponse> {
    if (!isVtbConfigured()) {
      serviceUnavailable('Payment gateway is not configured');
    }
    const amount = Math.trunc(credits);
    if (!Number.isFinite(amount) || amount <= 0) badRequest('credits must be a positive number');
    if (amount > MAX_TOPUP_CREDITS) badRequest(`credits must not exceed ${MAX_TOPUP_CREDITS}`);

    const uid = crypto.randomUUID();
    const now = nowIso();
    const amountMinor = amount * 100;
    const frontendBase = readFrontendBaseUrl();
    const returnUrl = `${frontendBase}/payment/return/${uid}`;
    const failUrl = `${frontendBase}/payment/fail/${uid}`;
    const expiresAt = new Date(Date.now() + SESSION_TIMEOUT_SECS * 1000).toISOString();

    this.db.run(
      `INSERT INTO payments (
        uid, user_uid, order_number, credits, amount_minor, currency, status,
        return_url, fail_url, expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'created', ?, ?, ?, ?, ?)`,
      [uid, userUid, uid, amount, amountMinor, KZT_CURRENCY, returnUrl, failUrl, expiresAt, now, now],
    );
    this.logEvent(uid, 'created', 'Payment record created', { credits: amount, amountMinor });

    const callbackUrl = `${readApiPublicBaseUrl()}/api/payments/vtb/callback`;
    const gatewayResult = await this.vtb.registerOrder({
      orderNumber: uid,
      amountMinor,
      currency: KZT_CURRENCY,
      returnUrl,
      failUrl,
      description: `Old Whale Krill top-up: ${amount} OWK`,
      dynamicCallbackUrl: callbackUrl,
    });

    if ('formUrl' in gatewayResult && gatewayResult.orderId && gatewayResult.formUrl) {
      this.db.run(
        `UPDATE payments SET
          gateway_order_id = ?, form_url = ?, status = 'registered', updated_at = ?
         WHERE uid = ?`,
        [gatewayResult.orderId, gatewayResult.formUrl, nowIso(), uid],
      );
      this.logEvent(uid, 'registered', 'Order registered with VTB', {
        gatewayOrderId: gatewayResult.orderId,
      });
      return { paymentId: uid, formUrl: gatewayResult.formUrl };
    }

    const errorCode = 'errorCode' in gatewayResult ? gatewayResult.errorCode : 'unknown';
    const errorMessage =
      'errorMessage' in gatewayResult ? gatewayResult.errorMessage : 'Registration failed';
    this.db.run(
      `UPDATE payments SET status = 'failed', error_code = ?, error_message = ?, updated_at = ? WHERE uid = ?`,
      [errorCode, errorMessage, nowIso(), uid],
    );
    this.logEvent(uid, 'register_failed', errorMessage, { errorCode });
    badGateway(errorMessage || 'Payment registration failed');
  }

  getPaymentForUser(userUid: string, paymentId: string): PaymentPublic {
    const row = this.requireOwnedPayment(userUid, paymentId);
    return this.toPublic(row);
  }

  async syncPayment(userUid: string, paymentId: string): Promise<PaymentSyncResponse> {
    const row = this.requireOwnedPayment(userUid, paymentId);
    return this.syncRow(row, 'return_sync');
  }

  handleCallback(params: Record<string, string>): void {
    if (!isVtbConfigured()) return;

    const secret = readVtbCallbackSecret();
    if (secret && !this.verifyCallbackChecksum(params, secret)) {
      this.logger.warn('VTB callback checksum verification failed');
      return;
    }

    const gatewayOrderId = params.mdOrder ?? params.orderId ?? '';
    const orderNumber = params.orderNumber ?? '';
    const operation = params.operation ?? '';
    const status = params.status ?? '';

    let row: PaymentRow | undefined;
    if (gatewayOrderId) {
      row = this.db.get<PaymentRow>('SELECT * FROM payments WHERE gateway_order_id = ?', [gatewayOrderId]);
    }
    if (!row && orderNumber) {
      row = this.db.get<PaymentRow>('SELECT * FROM payments WHERE order_number = ?', [orderNumber]);
    }
    if (!row) {
      this.logger.warn(`VTB callback for unknown order: mdOrder=${gatewayOrderId} orderNumber=${orderNumber}`);
      return;
    }

    this.logEvent(row.uid, 'callback', `operation=${operation} status=${status}`, this.redactParams(params));

    const deposited = operation === 'deposited' && status === '1';
    const declined =
      operation === 'declinedByTimeout' ||
      operation === 'declinedCardPresent' ||
      (status === '0' && operation !== '');

    if (declined) {
      this.db.run(
        `UPDATE payments SET status = 'failed', updated_at = ? WHERE uid = ? AND credited_at IS NULL`,
        [nowIso(), row.uid],
      );
      return;
    }

    if (deposited || gatewayOrderId) {
      void this.syncRow(row, 'callback').catch((error) => {
        this.logger.error(`VTB callback sync failed for ${row.uid}`, error);
      });
    }
  }

  private async syncRow(row: PaymentRow, source: string): Promise<PaymentSyncResponse> {
    if (row.credited_at) {
      return { payment: this.toPublic(this.requirePayment(row.uid)) };
    }

    if (!row.gateway_order_id) {
      return { payment: this.toPublic(row) };
    }

    const statusPayload = await this.vtb.getOrderStatusExtended(row.gateway_order_id);
    const updated = this.applyGatewayStatus(row.uid, statusPayload, source);

    if (isVtbOrderPaid(updated.order_status)) {
      const user = this.creditIfPaid(updated.uid);
      if (user) {
        return { payment: this.toPublic(this.requirePayment(updated.uid)), user };
      }
    }

    return { payment: this.toPublic(this.requirePayment(updated.uid)) };
  }

  private applyGatewayStatus(paymentUid: string, payload: VtbOrderStatus, source: string): PaymentRow {
    const now = nowIso();
    const orderStatus = payload.orderStatus ?? null;
    const actionCode = payload.actionCode ?? null;
    const gatewayOk = isVtbGatewaySuccess(payload);
    let status: PaymentStatus = 'pending';

    if (isVtbOrderPaid(orderStatus)) {
      status = 'paid';
    } else if (orderStatus === 6) {
      status = 'failed';
    } else if (orderStatus === 3) {
      status = 'canceled';
    } else if (orderStatus === 4) {
      status = 'refunded';
    } else if (!gatewayOk) {
      status = 'failed';
    } else if (orderStatus === 0 || orderStatus === 7) {
      status = 'registered';
    }

    this.db.run(
      `UPDATE payments SET
        order_status = ?, action_code = ?, error_code = ?, error_message = ?,
        status = ?, raw_last_gateway_response = ?, updated_at = ?
       WHERE uid = ?`,
      [
        orderStatus,
        actionCode,
        payload.errorCode ?? null,
        payload.errorMessage ?? null,
        status,
        JSON.stringify(this.redactGatewayPayload(payload)),
        now,
        paymentUid,
      ],
    );
    this.logEvent(paymentUid, `status_${source}`, `orderStatus=${orderStatus ?? 'null'}`, {
      actionCode,
      status,
    });
    return this.requirePayment(paymentUid);
  }

  private creditIfPaid(paymentUid: string): PublicUser | undefined {
    return this.db.transaction(() => {
      const row = this.db.get<PaymentRow>('SELECT * FROM payments WHERE uid = ?', [paymentUid]);
      if (!row || row.credited_at || !isVtbOrderPaid(row.order_status)) return undefined;

      const now = nowIso();
      const result = this.db.run(
        `UPDATE payments SET credited_at = ?, status = 'paid', updated_at = ?
         WHERE uid = ? AND credited_at IS NULL`,
        [now, now, paymentUid],
      );
      if (Number(result.changes) === 0) return undefined;

      const user = this.users.addCredits(row.user_uid, row.credits);
      this.logEvent(paymentUid, 'credited', `Granted ${row.credits} OWK`, { userUid: row.user_uid });
      this.logger.log(`Payment ${paymentUid}: credited ${row.credits} OWK to ${row.user_uid}`);
      return user;
    });
  }

  private requireOwnedPayment(userUid: string, paymentId: string): PaymentRow {
    const row = this.db.get<PaymentRow>('SELECT * FROM payments WHERE uid = ?', [paymentId]);
    if (!row) notFound('payment not found');
    if (row.user_uid !== userUid) notFound('payment not found');
    return row;
  }

  private requirePayment(paymentUid: string): PaymentRow {
    const row = this.db.get<PaymentRow>('SELECT * FROM payments WHERE uid = ?', [paymentUid]);
    if (!row) notFound('payment not found');
    return row;
  }

  private toPublic(row: PaymentRow): PaymentPublic {
    return {
      id: row.uid,
      status: row.status,
      credits: row.credits,
      amount_kzt: row.credits,
      credited: Boolean(row.credited_at),
      order_status: row.order_status,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  private logEvent(paymentUid: string, eventType: string, message: string, detail?: unknown): void {
    const detailJson = detail ? JSON.stringify(detail) : null;
    this.db.run(
      `INSERT INTO payment_events (payment_uid, event_type, message, detail_json, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [paymentUid, eventType, message, detailJson, nowIso()],
    );
    this.logger.log(`[payment:${paymentUid}] ${eventType}: ${message}`);
  }

  private redactGatewayPayload(payload: VtbOrderStatus): VtbOrderStatus {
    return payload;
  }

  private redactParams(params: Record<string, string>): Record<string, string> {
    const copy = { ...params };
    delete copy.checksum;
    return copy;
  }

  private verifyCallbackChecksum(params: Record<string, string>, secret: string): boolean {
    const received = params.checksum ?? '';
    if (!received) return false;

    const entries = Object.entries(params)
      .filter(([key]) => key !== 'checksum' && key !== 'sign_alias')
      .sort(([a], [b]) => a.localeCompare(b));

    const canonical = entries.map(([name, value]) => `${name};${value};`).join('');
    const expected = crypto.createHmac('sha256', secret).update(canonical).digest('hex').toUpperCase();

    try {
      return crypto.timingSafeEqual(Buffer.from(received.toUpperCase()), Buffer.from(expected));
    } catch {
      return false;
    }
  }
}
