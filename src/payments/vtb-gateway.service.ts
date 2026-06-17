import { Injectable, Logger } from '@nestjs/common';
import {
  isVtbConfigured,
  readVtbApiBaseUrl,
  readVtbMerchantPassword,
  readVtbMerchantUsername,
} from '../config/env';
import { badGateway, serviceUnavailable } from '../common/http-error';

export interface VtbRegisterParams {
  orderNumber: string;
  amountMinor: number;
  currency?: string;
  returnUrl: string;
  failUrl: string;
  description?: string;
  language?: string;
  dynamicCallbackUrl?: string;
}

export interface VtbRegisterSuccess {
  orderId: string;
  formUrl: string;
}

export interface VtbGatewayError {
  errorCode: string;
  errorMessage: string;
}

export interface VtbOrderStatus {
  orderNumber?: string;
  orderStatus?: number;
  actionCode?: number;
  actionCodeDescription?: string;
  amount?: number;
  currency?: string;
  errorCode?: string;
  errorMessage?: string;
  paymentAmountInfo?: { paymentState?: string };
}

@Injectable()
export class VtbGatewayService {
  private readonly logger = new Logger(VtbGatewayService.name);

  assertConfigured(): void {
    if (!isVtbConfigured()) {
      serviceUnavailable('Payment gateway is not configured');
    }
  }

  async registerOrder(params: VtbRegisterParams): Promise<VtbRegisterSuccess | VtbGatewayError> {
    this.assertConfigured();
    const body = new URLSearchParams({
      userName: readVtbMerchantUsername(),
      password: readVtbMerchantPassword(),
      orderNumber: params.orderNumber,
      amount: String(params.amountMinor),
      currency: params.currency ?? '398',
      returnUrl: params.returnUrl,
      failUrl: params.failUrl,
      description: params.description ?? 'Old Whale Krill top-up',
      language: params.language ?? 'ru',
    });
    if (params.dynamicCallbackUrl) {
      body.set('dynamicCallbackUrl', params.dynamicCallbackUrl);
    }
    return this.postJson<VtbRegisterSuccess | VtbGatewayError>('register.do', body);
  }

  async getOrderStatusExtended(gatewayOrderId: string): Promise<VtbOrderStatus> {
    this.assertConfigured();
    const body = new URLSearchParams({
      userName: readVtbMerchantUsername(),
      password: readVtbMerchantPassword(),
      orderId: gatewayOrderId,
      language: 'ru',
    });
    return this.postJson<VtbOrderStatus>('getOrderStatusExtended.do', body);
  }

  private async postJson<T>(endpoint: string, body: URLSearchParams): Promise<T> {
    const url = `${readVtbApiBaseUrl()}${endpoint}`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
    } catch (error) {
      this.logger.error(`VTB request failed: ${endpoint}`, error);
      badGateway('Payment gateway is unreachable');
    }

    const text = await response.text();
    let parsed: T;
    try {
      parsed = JSON.parse(text) as T;
    } catch {
      this.logger.error(`VTB invalid JSON (${response.status}): ${text.slice(0, 500)}`);
      badGateway('Payment gateway returned an invalid response');
    }

    if (!response.ok) {
      this.logger.error(`VTB HTTP ${response.status}: ${text.slice(0, 500)}`);
      badGateway('Payment gateway error');
    }

    return parsed;
  }
}

/** Returns true when the gateway reports a captured or pre-authorized payment. */
export function isVtbOrderPaid(orderStatus: number | undefined | null): boolean {
  return orderStatus === 1 || orderStatus === 2;
}

export function isVtbGatewaySuccess(payload: { errorCode?: string; success?: boolean }): boolean {
  if (payload.success === true) return true;
  if (payload.success === false) return false;
  if (payload.errorCode === undefined || payload.errorCode === '') return true;
  return payload.errorCode === '0';
}
