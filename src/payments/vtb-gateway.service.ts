import { Injectable } from '@nestjs/common';
import {
  isVtbConfigured,
  readVtbApiBaseUrl,
  readVtbApiPassword,
  readVtbApiToken,
  readVtbApiUserName,
  readVtbHttpTimeoutMs,
} from '../config/env';
import { PaymentEventsService } from './payment-events.service';
import { redactSecrets, summarizeError } from './redact';

export interface VtbRegisterInput {
  orderNumber: string;
  /** Amount in minor units (tiyin for KZT). */
  amount: number;
  currency: string;
  returnUrl: string;
  failUrl: string;
  description?: string;
  language?: string;
  email?: string;
  clientId?: string;
  dynamicCallbackUrl?: string;
  sessionTimeoutSecs?: number;
}

export interface VtbRegisterResult {
  ok: boolean;
  orderId?: string;
  formUrl?: string;
  errorCode?: string;
  errorMessage?: string;
  httpStatus: number;
  raw: unknown;
}

export interface VtbOrderStatusInput {
  orderId?: string;
  orderNumber?: string;
  language?: string;
}

export interface VtbOrderStatusResult {
  ok: boolean;
  orderStatus?: number;
  actionCode?: string;
  actionCodeDescription?: string;
  amount?: number;
  currency?: string;
  orderNumber?: string;
  errorCode?: string;
  errorMessage?: string;
  httpStatus: number;
  raw: unknown;
}

interface PostFormResult {
  httpStatus: number;
  json: Record<string, unknown> | null;
  rawText: string;
}

/**
 * Thin HTTP client for the VTB Kazakhstan (RBS) REST gateway. Knows nothing
 * about our domain — it only builds form-encoded requests, attaches merchant
 * credentials, enforces a timeout, and parses the JSON envelope. Every call is
 * logged (request params redacted, response summarized) through
 * PaymentEventsService so a failed call is fully reconstructable from logs.
 */
@Injectable()
export class VtbGatewayService {
  constructor(private readonly events: PaymentEventsService) {}

  isConfigured(): boolean {
    return isVtbConfigured();
  }

  async register(paymentUid: string, input: VtbRegisterInput): Promise<VtbRegisterResult> {
    const params: Record<string, string> = {
      orderNumber: input.orderNumber,
      amount: String(input.amount),
      currency: input.currency,
      returnUrl: input.returnUrl,
      failUrl: input.failUrl,
    };
    if (input.description) params.description = input.description;
    if (input.language) params.language = input.language;
    if (input.email) params.email = input.email;
    if (input.clientId) params.clientId = input.clientId;
    if (input.dynamicCallbackUrl) params.dynamicCallbackUrl = input.dynamicCallbackUrl;
    if (input.sessionTimeoutSecs) params.sessionTimeoutSecs = String(input.sessionTimeoutSecs);

    const result = await this.postForm(paymentUid, 'register.do', params);
    const json = result.json ?? {};
    const errorCode = normalizeCode(json.errorCode);
    const formUrl = typeof json.formUrl === 'string' ? json.formUrl : undefined;
    const orderId = typeof json.orderId === 'string' ? json.orderId : undefined;
    const ok = Boolean(formUrl) && (errorCode === undefined || errorCode === '0');

    return {
      ok,
      orderId,
      formUrl,
      errorCode,
      errorMessage: asString(json.errorMessage),
      httpStatus: result.httpStatus,
      raw: redactSecrets(json),
    };
  }

  async getOrderStatus(paymentUid: string, input: VtbOrderStatusInput): Promise<VtbOrderStatusResult> {
    const params: Record<string, string> = {};
    if (input.orderId) params.orderId = input.orderId;
    if (input.orderNumber) params.orderNumber = input.orderNumber;
    if (input.language) params.language = input.language;

    const result = await this.postForm(paymentUid, 'getOrderStatusExtended.do', params);
    const json = result.json ?? {};
    const errorCode = normalizeCode(json.errorCode);
    const ok = errorCode === undefined || errorCode === '0';

    return {
      ok,
      orderStatus: asNumber(json.orderStatus),
      actionCode: normalizeCode(json.actionCode),
      actionCodeDescription: asString(json.actionCodeDescription),
      amount: asNumber(json.amount),
      currency: asString(json.currency),
      orderNumber: asString(json.orderNumber),
      errorCode,
      errorMessage: asString(json.errorMessage),
      httpStatus: result.httpStatus,
      raw: redactSecrets(json),
    };
  }

  /** Adds auth fields without ever exposing them to callers or logs. */
  private authParams(): Record<string, string> {
    const token = readVtbApiToken();
    if (token) return { token };
    return { userName: readVtbApiUserName(), password: readVtbApiPassword() };
  }

  private async postForm(
    paymentUid: string,
    endpoint: string,
    params: Record<string, string>,
  ): Promise<PostFormResult> {
    const url = `${readVtbApiBaseUrl()}${endpoint}`;
    const body = new URLSearchParams({ ...this.authParams(), ...params });
    const timeoutMs = readVtbHttpTimeoutMs();

    // Log the request with credentials redacted; never log the encoded body string.
    this.events.record(paymentUid, `gateway.${endpoint}.request`, `POST ${endpoint}`, {
      url,
      params: redactSecrets({ ...this.authParams(), ...params }),
      timeoutMs,
    });

    const startedAt = Date.now();
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      this.events.record(
        paymentUid,
        `gateway.${endpoint}.transport_error`,
        `transport error after ${durationMs}ms`,
        { error: summarizeError(error), durationMs },
        'error',
      );
      throw error;
    }

    const durationMs = Date.now() - startedAt;
    const rawText = await response.text();
    let json: Record<string, unknown> | null = null;
    try {
      json = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : null;
    } catch {
      json = null;
    }

    this.events.record(
      paymentUid,
      `gateway.${endpoint}.response`,
      `HTTP ${response.status} in ${durationMs}ms`,
      {
        httpStatus: response.status,
        durationMs,
        body: json ? redactSecrets(json) : truncate(rawText, 1000),
      },
      response.ok ? 'info' : 'warn',
    );

    return { httpStatus: response.status, json, rawText };
  }
}

function normalizeCode(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return String(value);
}

function asString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return String(value);
}

function asNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
