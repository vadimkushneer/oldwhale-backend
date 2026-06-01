import { Injectable } from '@nestjs/common';
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

@Injectable()
export class VtbClient {
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

  isPaid(response: VtbOrderStatusResponse): boolean {
    return successCode(response.errorCode) && response.orderStatus === 2;
  }

  private withAuth(params: Record<string, string | number | undefined>): Record<string, string | number> {
    const token = readVtbToken();
    if (token) return { ...params, token };
    return { ...params, userName: readVtbUserName(), password: readVtbPassword() };
  }

  private async postForm<T>(path: string, params: Record<string, string | number | undefined>): Promise<T> {
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
      badRequest(`VTB returned a non-JSON response with HTTP ${response.status}`);
    }
    if (!response.ok) badRequest(`VTB request failed with HTTP ${response.status}`);
    return parsed as T;
  }
}
