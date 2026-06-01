import crypto from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { badRequest, forbidden, notFound } from '../common/http-error';
import { nowIso } from '../common/time';
import {
  readFrontendBaseUrl,
  readPublicApiBaseUrl,
  readVtbCurrency,
  readVtbDynamicCallbackUrl,
  readVtbMinorUnitsPerOwk,
  readVtbSessionTimeoutSeconds,
} from '../config/env';
import { SqliteService } from '../database/sqlite.service';
import type { PublicUser } from '../users/users.types';
import type { PaymentOrderPublic, PaymentOrderRow, PaymentOrderStatus, VtbCreateOrderResponse } from './payments.types';
import { VtbClient, type VtbOrderStatusResponse } from './vtb.client';

const PROVIDER_VTB = 'vtb';
const MAX_TOPUP_CREDITS = 100_000;

function json(value: unknown): string {
  return JSON.stringify(value);
}

function parsePositiveCredits(value: unknown): number {
  const amount = Math.trunc(Number(value));
  if (!Number.isFinite(amount) || amount <= 0) badRequest('amount must be a positive number');
  if (amount > MAX_TOPUP_CREDITS) badRequest(`amount must not exceed ${MAX_TOPUP_CREDITS}`);
  return amount;
}

function localOrderNumber(): string {
  return `OW${crypto.randomUUID().replace(/-/g, '')}`;
}

function ensureSafeMinorAmount(credits: number): number {
  const amountMinor = credits * readVtbMinorUnitsPerOwk();
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) badRequest('payment amount is invalid');
  return amountMinor;
}

function vtbCallbackUrl(publicApiBase: string): string | undefined {
  const explicit = readVtbDynamicCallbackUrl();
  if (explicit.startsWith('https://')) return explicit;
  return publicApiBase.startsWith('https://') ? `${publicApiBase}/api/payments/vtb/callback` : undefined;
}

function publicOrder(row: PaymentOrderRow): PaymentOrderPublic {
  return {
    uid: row.uid,
    provider: row.provider,
    status: row.status,
    credits: Number(row.credits),
    amount_minor: Number(row.amount_minor),
    currency: row.currency,
    form_url: row.form_url,
    credited_at: row.credited_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly db: SqliteService,
    private readonly vtb: VtbClient,
  ) {}

  async createVtbOrder(user: PublicUser, body: { amount?: number }): Promise<VtbCreateOrderResponse> {
    const credits = parsePositiveCredits(body?.amount);
    const amountMinor = ensureSafeMinorAmount(credits);
    const uid = crypto.randomUUID();
    const orderNumber = localOrderNumber();
    const currency = readVtbCurrency();
    const now = nowIso();
    const publicApiBase = readPublicApiBaseUrl();
    const returnUrl = `${publicApiBase}/api/payments/vtb/return?order_uid=${encodeURIComponent(uid)}`;
    const failUrl = `${publicApiBase}/api/payments/vtb/return?order_uid=${encodeURIComponent(uid)}&failed=1`;
    const localCallbackUrl = `${publicApiBase}/api/payments/vtb/callback`;
    const dynamicCallbackUrl = vtbCallbackUrl(publicApiBase);

    this.db.run(
      `INSERT INTO payment_orders
       (uid, user_uid, provider, order_number, credits, amount_minor, currency, status, return_url, fail_url, callback_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [uid, user.uid, PROVIDER_VTB, orderNumber, credits, amountMinor, currency, 'pending', returnUrl, failUrl, dynamicCallbackUrl ?? localCallbackUrl, now, now],
    );

    const { request, response } = await this.vtb.registerOrder({
      orderNumber,
      amountMinor,
      currency,
      returnUrl,
      failUrl,
      callbackUrl: dynamicCallbackUrl,
      email: user.email,
      clientId: user.uid,
      description: `OldWhale credits ${credits} OWK`,
      sessionTimeoutSeconds: readVtbSessionTimeoutSeconds(),
    });

    const registeredAt = nowIso();
    if (String(response.errorCode ?? '0') !== '0' || !response.orderId || !response.formUrl) {
      this.db.run(
        `UPDATE payment_orders
         SET status = ?, raw_register_request_json = ?, raw_register_response_json = ?, updated_at = ?
         WHERE uid = ?`,
        ['failed', json(request), json(response), registeredAt, uid],
      );
      badRequest(response.errorMessage || 'VTB order registration failed');
    }

    this.db.run(
      `UPDATE payment_orders
       SET status = ?, vtb_order_id = ?, form_url = ?, raw_register_request_json = ?, raw_register_response_json = ?, updated_at = ?
       WHERE uid = ?`,
      ['registered', response.orderId, response.formUrl, json(request), json(response), registeredAt, uid],
    );

    void this.vtb.getOrderStatus(response.orderId).catch((error: unknown) => {
      this.logger.warn(
        `VTB post-register status probe failed orderUid=${uid} orderNumber=${orderNumber} vtbOrderId=${response.orderId} error=${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });

    const row = this.findRowByUid(uid);
    return {
      order_uid: row.uid,
      form_url: row.form_url!,
      status: row.status,
      credits: row.credits,
      amount_minor: row.amount_minor,
      currency: row.currency,
    };
  }

  getOrderForUser(uid: string, user: PublicUser): PaymentOrderPublic {
    const row = this.findRowByUid(uid);
    if (row.user_uid !== user.uid && user.role !== 'admin') forbidden();
    return publicOrder(row);
  }

  async refreshOrderForUser(uid: string, user: PublicUser): Promise<PaymentOrderPublic> {
    const row = this.findRowByUid(uid);
    if (row.user_uid !== user.uid && user.role !== 'admin') forbidden();
    if (!row.vtb_order_id || row.status === 'paid') return publicOrder(row);
    return publicOrder(await this.verifyAndSync(row));
  }

  async handleReturn(input: { orderUid?: string; vtbOrderId?: string; orderNumber?: string; failed?: boolean }): Promise<{ order: PaymentOrderPublic; redirectUrl: string }> {
    const row = this.findRowFromGatewayInput(input);
    const updated = row.vtb_order_id ? await this.verifyAndSync(row) : row;
    const order = publicOrder(input.failed && updated.status !== 'paid' ? this.markFailed(updated, undefined) : updated);
    return { order, redirectUrl: this.frontendReturnUrl(order) };
  }

  async handleVtbCallback(params: Record<string, unknown>): Promise<PaymentOrderPublic> {
    const row = this.findRowFromGatewayInput({
      vtbOrderId: stringParam(params.mdOrder) || stringParam(params.orderId),
      orderNumber: stringParam(params.orderNumber),
    });
    const withCallback = this.storeCallback(row, params);
    if (!withCallback.vtb_order_id) return publicOrder(withCallback);
    return publicOrder(await this.verifyAndSync(withCallback));
  }

  private async verifyAndSync(row: PaymentOrderRow): Promise<PaymentOrderRow> {
    if (!row.vtb_order_id) return row;
    const status = await this.vtb.getOrderStatus(row.vtb_order_id);
    return this.applyVtbStatus(row.uid, status);
  }

  private applyVtbStatus(uid: string, status: VtbOrderStatusResponse): PaymentOrderRow {
    return this.db.transaction(() => {
      const current = this.findRowByUid(uid);
      const now = nowIso();
      const matchesOrder = !status.orderNumber || status.orderNumber === current.order_number;
      const matchesAmount = status.amount === undefined || Number(status.amount) === Number(current.amount_minor);
      const matchesCurrency = !status.currency || status.currency === current.currency;
      const paid = this.vtb.isPaid(status) && matchesOrder && matchesAmount && matchesCurrency;
      const nextStatus = paid ? 'paid' : this.statusFromVtb(status);

      if (paid && !current.credited_at) {
        this.db.run('UPDATE users SET credits = credits + ?, updated_at = ? WHERE uid = ?', [current.credits, now, current.user_uid]);
        this.db.run(
          `UPDATE payment_orders
           SET status = ?, raw_status_response_json = ?, credited_at = ?, updated_at = ?
           WHERE uid = ?`,
          [nextStatus, json(status), now, now, uid],
        );
      } else {
        this.db.run(
          `UPDATE payment_orders
           SET status = ?, raw_status_response_json = ?, updated_at = ?
           WHERE uid = ?`,
          [current.credited_at ? 'paid' : nextStatus, json(status), now, uid],
        );
      }

      return this.findRowByUid(uid);
    });
  }

  private statusFromVtb(status: VtbOrderStatusResponse): PaymentOrderStatus {
    if (String(status.errorCode ?? '0') !== '0') return 'failed';
    if (status.orderStatus === 4) return 'refunded';
    if (status.orderStatus === 3 || status.orderStatus === 6) return 'failed';
    return 'registered';
  }

  private markFailed(row: PaymentOrderRow, rawCallback: Record<string, unknown> | undefined): PaymentOrderRow {
    const now = nowIso();
    this.db.run(
      `UPDATE payment_orders
       SET status = ?, raw_callback_json = COALESCE(?, raw_callback_json), updated_at = ?
       WHERE uid = ? AND credited_at IS NULL`,
      ['failed', rawCallback ? json(rawCallback) : null, now, row.uid],
    );
    return this.findRowByUid(row.uid);
  }

  private storeCallback(row: PaymentOrderRow, params: Record<string, unknown>): PaymentOrderRow {
    const operation = stringParam(params.operation);
    const status = stringParam(params.status);
    if ((operation === 'reversed' || operation === 'refunded' || operation === 'declinedByTimeout') && status === '1') {
      return this.markFailed(row, params);
    }
    this.db.run('UPDATE payment_orders SET raw_callback_json = ?, updated_at = ? WHERE uid = ?', [json(params), nowIso(), row.uid]);
    return this.findRowByUid(row.uid);
  }

  private frontendReturnUrl(order: PaymentOrderPublic): string {
    const url = new URL(`${readFrontendBaseUrl()}/payments/vtb/return`);
    url.searchParams.set('order_uid', order.uid);
    url.searchParams.set('status', order.status);
    return url.toString();
  }

  private findRowFromGatewayInput(input: { orderUid?: string; vtbOrderId?: string; orderNumber?: string }): PaymentOrderRow {
    if (input.orderUid) return this.findRowByUid(input.orderUid);
    if (input.orderNumber) {
      const byOrderNumber = this.db.get<PaymentOrderRow>('SELECT * FROM payment_orders WHERE order_number = ?', [input.orderNumber]);
      if (byOrderNumber) return byOrderNumber;
    }
    if (input.vtbOrderId) {
      const byVtbOrder = this.db.get<PaymentOrderRow>('SELECT * FROM payment_orders WHERE vtb_order_id = ?', [input.vtbOrderId]);
      if (byVtbOrder) return byVtbOrder;
    }
    notFound('payment order not found');
  }

  private findRowByUid(uid: string): PaymentOrderRow {
    const row = this.db.get<PaymentOrderRow>('SELECT * FROM payment_orders WHERE uid = ?', [uid]);
    if (!row) notFound('payment order not found');
    return row;
  }
}

function stringParam(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}
