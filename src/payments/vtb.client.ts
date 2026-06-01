import { Injectable, Logger } from '@nestjs/common';
import { badRequest } from '../common/http-error';
import { readVtbApiBaseUrl, readVtbLanguage, readVtbPassword, readVtbToken, readVtbUserName } from '../config/env';

export interface VtbRegisterOrderInput {
  orderNumber: string;
  amountMinor: number;
  currency: string;
  returnUrl: string;
  failUrl: string;
  callbackUrl?: string;
  description: string;
  email?: string;
  clientId?: string;
  sessionTimeoutSeconds?: number;
}

export interface VtbRegisterOrderResponse {
  orderId?: string;
  formUrl?: string;
  errorCode?: string | number;
  errorMessage?: string;
}

export interface VtbOrderStatusResponse {
  errorCode?: string | number;
  errorMessage?: string;
  orderNumber?: string;
  orderStatus?: number;
  actionCode?: string | number;
  actionCodeDescription?: string;
  amount?: number;
  currency?: string;
  paymentAmountInfo?: {
    paymentState?: string;
    approvedAmount?: number;
    depositedAmount?: number;
    refundedAmount?: number;
  };
  [key: string]: unknown;
}

export interface VtbSessionStatusResponse {
  errorCode?: string | number;
  errorMessage?: string;
  remainingSecs?: number;
  orderNumber?: string;
  amount?: string;
  backUrl?: string;
  orderExpired?: boolean;
  currencyAlphaCode?: string;
  currencyNumericCode?: string;
  merchantInfo?: {
    merchantLogin?: string;
    merchantUrl?: string;
    merchantFullName?: string;
  };
  merchantOptions?: string[];
  [key: string]: unknown;
}

function compactParams(params: Record<string, string | number | undefined>): URLSearchParams {
  const body = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '') body.set(key, String(value));
  });
  return body;
}

function successCode(value: unknown): boolean {
  return value === undefined || value === null || value === '' || String(value) === '0';
}

function summarizeFormUrl(value: unknown): { host?: string; path?: string; mdOrder?: string; language?: string } | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  try {
    const url = new URL(value);
    return {
      host: url.host,
      path: url.pathname,
      mdOrder: url.searchParams.get('mdOrder') ?? undefined,
      language: url.searchParams.get('language') ?? undefined,
    };
  } catch {
    return { path: value };
  }
}

function safeRequestSummary(params: Record<string, string | number | undefined>): Record<string, unknown> {
  return {
    orderNumber: params.orderNumber,
    orderId: params.orderId,
    MDORDER: params.MDORDER,
    amount: params.amount,
    currency: params.currency,
    language: params.language,
    returnUrl: params.returnUrl,
    failUrl: params.failUrl,
    dynamicCallbackUrl: params.dynamicCallbackUrl,
    hasDynamicCallbackUrl: Boolean(params.dynamicCallbackUrl),
    hasToken: Boolean(params.token),
    hasPassword: Boolean(params.password),
    hasUserName: Boolean(params.userName),
    clientId: params.clientId,
    sessionTimeoutSecs: params.sessionTimeoutSecs,
  };
}

function safeResponseSummary(path: string, value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return { responseType: typeof value };
  const response = value as Record<string, unknown>;
  if (path === 'register.do') {
    return {
      errorCode: response.errorCode,
      errorMessage: response.errorMessage,
      orderId: response.orderId,
      formUrl: summarizeFormUrl(response.formUrl),
    };
  }
  if (path === 'getSessionStatus.do') {
    const merchantInfo = response.merchantInfo as VtbSessionStatusResponse['merchantInfo'] | undefined;
    return {
      errorCode: response.errorCode,
      errorMessage: response.errorMessage,
      remainingSecs: response.remainingSecs,
      orderNumber: response.orderNumber,
      amount: response.amount,
      backUrl: response.backUrl,
      orderExpired: response.orderExpired,
      currencyAlphaCode: response.currencyAlphaCode,
      currencyNumericCode: response.currencyNumericCode,
      merchantOptions: response.merchantOptions,
      merchantInfo: merchantInfo
        ? {
            merchantLogin: merchantInfo.merchantLogin,
            merchantUrl: merchantInfo.merchantUrl,
            merchantFullName: merchantInfo.merchantFullName,
          }
        : undefined,
    };
  }
  return {
    errorCode: response.errorCode,
    errorMessage: response.errorMessage,
    orderNumber: response.orderNumber,
    orderStatus: response.orderStatus,
    actionCode: response.actionCode,
    actionCodeDescription: response.actionCodeDescription,
    amount: response.amount,
    currency: response.currency,
    paymentAmountInfo: response.paymentAmountInfo,
  };
}

@Injectable()
export class VtbClient {
  private readonly logger = new Logger(VtbClient.name);

  async registerOrder(input: VtbRegisterOrderInput): Promise<{ request: Record<string, string | number>; response: VtbRegisterOrderResponse }> {
    const request = this.withAuth({
      orderNumber: input.orderNumber,
      amount: input.amountMinor,
      currency: input.currency,
      returnUrl: input.returnUrl,
      failUrl: input.failUrl,
      dynamicCallbackUrl: input.callbackUrl,
      description: input.description,
      language: readVtbLanguage(),
      email: input.email,
      clientId: input.clientId,
      sessionTimeoutSecs: input.sessionTimeoutSeconds,
    });
    const response = await this.postForm<VtbRegisterOrderResponse>('register.do', request);
    return { request, response };
  }

  async getOrderStatus(orderId: string): Promise<VtbOrderStatusResponse> {
    return this.postForm<VtbOrderStatusResponse>(
      'getOrderStatusExtended.do',
      this.withAuth({
        orderId,
        language: readVtbLanguage(),
      }),
    );
  }

  async getSessionStatus(orderId: string): Promise<VtbSessionStatusResponse> {
    return this.postForm<VtbSessionStatusResponse>('getSessionStatus.do', {
      MDORDER: orderId,
    });
  }

  isPaid(response: VtbOrderStatusResponse): boolean {
    return successCode(response.errorCode) && response.orderStatus === 2;
  }

  private withAuth(params: Record<string, string | number | undefined>): Record<string, string | number> {
    const token = readVtbToken();
    if (token) return { ...params, token };
    return { ...params, userName: readVtbUserName(), password: readVtbPassword() };
  }

  private async postForm<T>(path: string, params: Record<string, string | number | undefined>): Promise<T> {
    const startedAt = Date.now();
    const url = new URL(path, readVtbApiBaseUrl());
    this.logger.log(`VTB request ${path} ${JSON.stringify(safeRequestSummary(params))}`);
    const response = await fetch(new URL(path, readVtbApiBaseUrl()), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: compactParams(params),
    });
    const text = await response.text();
    let parsed: unknown = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      this.logger.error(`VTB response ${path} http=${response.status} durationMs=${Date.now() - startedAt} nonJsonBody=${JSON.stringify(text.slice(0, 500))}`);
      badRequest(`VTB returned a non-JSON response with HTTP ${response.status}`);
    }
    const level = response.ok && successCode((parsed as { errorCode?: unknown }).errorCode) ? 'log' : 'warn';
    this.logger[level](
      `VTB response ${path} http=${response.status} durationMs=${Date.now() - startedAt} url=${url.toString()} ${JSON.stringify(safeResponseSummary(path, parsed))}`,
    );
    if (!response.ok) badRequest(`VTB request failed with HTTP ${response.status}`);
    return parsed as T;
  }
}
