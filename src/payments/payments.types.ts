export type PaymentStatus =
  | 'created'
  | 'registered'
  | 'pending'
  | 'paid'
  | 'failed'
  | 'canceled'
  | 'refunded';

export interface PaymentRow {
  uid: string;
  user_uid: string;
  order_number: string;
  gateway_order_id: string | null;
  credits: number;
  amount_minor: number;
  currency: string;
  status: PaymentStatus;
  form_url: string | null;
  return_url: string;
  fail_url: string;
  order_status: number | null;
  action_code: number | null;
  error_code: string | null;
  error_message: string | null;
  credited_at: string | null;
  raw_last_gateway_response: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PaymentPublic {
  id: string;
  status: PaymentStatus;
  credits: number;
  amount_kzt: number;
  credited: boolean;
  order_status: number | null;
  created_at: string;
  updated_at: string;
}

export interface PaymentCreateResponse {
  paymentId: string;
  formUrl: string;
}

export interface PaymentSyncResponse {
  payment: PaymentPublic;
  user?: import('../users/users.types').PublicUser;
}
