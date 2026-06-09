/**
 * Local payment state machine for VTB Kazakhstan eCommerce top-ups.
 *
 * created    — row inserted, not yet registered on the gateway
 * registered — register.do succeeded, formUrl issued, payer not yet returned
 * pending    — payer returned / callback seen but gateway not in a final state
 * paid       — gateway orderStatus ∈ {1,2}; credits granted exactly once
 * failed     — register.do failed or gateway reported a decline (orderStatus 6)
 * canceled   — authorization reversed (orderStatus 3)
 * refunded   — refunded on the gateway (orderStatus 4)
 */
export type PaymentStatus =
  | 'created'
  | 'registered'
  | 'pending'
  | 'paid'
  | 'failed'
  | 'canceled'
  | 'refunded';

export type PaymentEventLevel = 'info' | 'warn' | 'error';

export interface PaymentRow {
  id: number;
  uid: string;
  order_number: string;
  user_uid: string;
  credits: number;
  amount_minor: number;
  currency: string;
  status: PaymentStatus;
  gateway_order_id: string | null;
  form_url: string | null;
  return_url: string | null;
  fail_url: string | null;
  order_status: number | null;
  action_code: string | null;
  error_code: string | null;
  error_message: string | null;
  raw_last_gateway_response: string | null;
  credited_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Shape returned to the browser — never includes gateway credentials. */
export interface PublicPayment {
  uid: string;
  orderNumber: string;
  credits: number;
  amountMinor: number;
  currency: string;
  status: PaymentStatus;
  gatewayOrderId: string | null;
  formUrl: string | null;
  orderStatus: number | null;
  actionCode: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  creditedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}
