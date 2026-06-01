export type PaymentOrderStatus = 'pending' | 'registered' | 'paid' | 'failed' | 'refunded';

export interface PaymentOrderRow {
  id: number;
  uid: string;
  user_uid: string;
  provider: string;
  order_number: string;
  credits: number;
  amount_minor: number;
  currency: string;
  status: PaymentOrderStatus;
  vtb_order_id: string | null;
  form_url: string | null;
  return_url: string;
  fail_url: string;
  callback_url: string;
  raw_register_request_json: string | null;
  raw_register_response_json: string | null;
  raw_status_response_json: string | null;
  raw_callback_json: string | null;
  credited_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PaymentOrderPublic {
  uid: string;
  provider: string;
  status: PaymentOrderStatus;
  credits: number;
  amount_minor: number;
  currency: string;
  form_url: string | null;
  credited_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface VtbCreateOrderResponse {
  order_uid: string;
  form_url: string;
  status: PaymentOrderStatus;
  credits: number;
  amount_minor: number;
  currency: string;
}
