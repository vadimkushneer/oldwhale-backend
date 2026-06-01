jest.mock('../database/sqlite.service', () => ({ SqliteService: class SqliteService {} }));

import type { PublicUser } from '../users/users.types';
import { PaymentsService } from './payments.service';
import type { PaymentOrderRow } from './payments.types';
import type { VtbClient, VtbOrderStatusResponse, VtbRegisterOrderInput } from './vtb.client';

type UserRecord = { uid: string; credits: number; updated_at: string };

class InMemoryDb {
  users = new Map<string, UserRecord>();
  orders: PaymentOrderRow[] = [];

  run(sql: string, params: unknown[] = []): { changes: number; lastInsertRowid: number } {
    if (sql.includes('INSERT INTO payment_orders')) {
      const [uid, userUid, provider, orderNumber, credits, amountMinor, currency, status, returnUrl, failUrl, callbackUrl, createdAt, updatedAt] = params;
      this.orders.push({
        id: this.orders.length + 1,
        uid: String(uid),
        user_uid: String(userUid),
        provider: String(provider),
        order_number: String(orderNumber),
        credits: Number(credits),
        amount_minor: Number(amountMinor),
        currency: String(currency),
        status: status as PaymentOrderRow['status'],
        vtb_order_id: null,
        form_url: null,
        return_url: String(returnUrl),
        fail_url: String(failUrl),
        callback_url: String(callbackUrl),
        raw_register_request_json: null,
        raw_register_response_json: null,
        raw_status_response_json: null,
        raw_callback_json: null,
        credited_at: null,
        created_at: String(createdAt),
        updated_at: String(updatedAt),
      });
      return { changes: 1, lastInsertRowid: this.orders.length };
    }

    if (sql.includes('UPDATE users SET credits = credits + ?')) {
      const [delta, updatedAt, uid] = params;
      const user = this.users.get(String(uid));
      if (user) {
        user.credits += Number(delta);
        user.updated_at = String(updatedAt);
      }
      return { changes: user ? 1 : 0, lastInsertRowid: 0 };
    }

    if (sql.includes('UPDATE payment_orders')) {
      return this.updateOrder(sql, params);
    }

    throw new Error(`Unhandled SQL: ${sql}`);
  }

  get<T>(sql: string, params: unknown[] = []): T | undefined {
    if (sql.includes('SELECT * FROM payment_orders WHERE uid = ?')) {
      return this.orders.find((order) => order.uid === params[0]) as T | undefined;
    }
    if (sql.includes('SELECT * FROM payment_orders WHERE order_number = ?')) {
      return this.orders.find((order) => order.order_number === params[0]) as T | undefined;
    }
    if (sql.includes('SELECT * FROM payment_orders WHERE vtb_order_id = ?')) {
      return this.orders.find((order) => order.vtb_order_id === params[0]) as T | undefined;
    }
    if (sql.includes('SELECT * FROM payment_orders LIMIT 1')) {
      return this.orders[0] as T | undefined;
    }
    if (sql.includes('SELECT credits FROM users WHERE uid = ?')) {
      const user = this.users.get(String(params[0]));
      return (user ? { credits: user.credits } : undefined) as T | undefined;
    }
    throw new Error(`Unhandled SQL: ${sql}`);
  }

  transaction<T>(fn: () => T): T {
    return fn();
  }

  private updateOrder(sql: string, params: unknown[]): { changes: number; lastInsertRowid: number } {
    const uid = String(params[params.length - 1]);
    const order = this.orders.find((item) => item.uid === uid);
    if (!order) return { changes: 0, lastInsertRowid: 0 };

    if (sql.includes('raw_register_request_json') && sql.includes('vtb_order_id')) {
      const [status, vtbOrderId, formUrl, rawRequest, rawResponse, updatedAt] = params;
      Object.assign(order, {
        status,
        vtb_order_id: String(vtbOrderId),
        form_url: String(formUrl),
        raw_register_request_json: String(rawRequest),
        raw_register_response_json: String(rawResponse),
        updated_at: String(updatedAt),
      });
      return { changes: 1, lastInsertRowid: 0 };
    }

    if (sql.includes('raw_register_request_json')) {
      const [status, rawRequest, rawResponse, updatedAt] = params;
      Object.assign(order, {
        status,
        raw_register_request_json: String(rawRequest),
        raw_register_response_json: String(rawResponse),
        updated_at: String(updatedAt),
      });
      return { changes: 1, lastInsertRowid: 0 };
    }

    if (sql.includes('raw_status_response_json') && sql.includes('credited_at')) {
      const [status, rawStatus, creditedAt, updatedAt] = params;
      Object.assign(order, {
        status,
        raw_status_response_json: String(rawStatus),
        credited_at: String(creditedAt),
        updated_at: String(updatedAt),
      });
      return { changes: 1, lastInsertRowid: 0 };
    }

    if (sql.includes('raw_status_response_json')) {
      const [status, rawStatus, updatedAt] = params;
      Object.assign(order, {
        status,
        raw_status_response_json: String(rawStatus),
        updated_at: String(updatedAt),
      });
      return { changes: 1, lastInsertRowid: 0 };
    }

    if (sql.includes('raw_callback_json = COALESCE')) {
      const [status, rawCallback, updatedAt] = params;
      if (!order.credited_at) {
        order.status = status as PaymentOrderRow['status'];
        if (rawCallback) order.raw_callback_json = String(rawCallback);
        order.updated_at = String(updatedAt);
      }
      return { changes: 1, lastInsertRowid: 0 };
    }

    if (sql.includes('raw_callback_json')) {
      const [rawCallback, updatedAt] = params;
      order.raw_callback_json = String(rawCallback);
      order.updated_at = String(updatedAt);
      return { changes: 1, lastInsertRowid: 0 };
    }

    throw new Error(`Unhandled update SQL: ${sql}`);
  }
}

function insertUser(db: InMemoryDb, credits = 0): PublicUser {
  const now = new Date().toISOString();
  db.users.set('user-1', { uid: 'user-1', credits, updated_at: now });
  return {
    id: 1,
    uid: 'user-1',
    login: 'alice',
    username: 'alice',
    email: 'alice@example.com',
    role: 'user',
    disabled: false,
    credits,
    last_login_at: null,
    created_at: now,
    updated_at: now,
  };
}

function fakeVtb(overrides: Partial<VtbClient> = {}): VtbClient {
  return {
    registerOrder: jest.fn(async (input: VtbRegisterOrderInput) => ({
      request: { amount: input.amountMinor, orderNumber: input.orderNumber },
      response: { orderId: 'vtb-order-1', formUrl: 'https://vtb.example/form' },
    })),
    getOrderStatus: jest.fn(async () => ({ errorCode: '0', orderStatus: 2, amount: 1000, currency: '398', orderNumber: '' })),
    getSessionStatus: jest.fn(async () => ({ remainingSecs: 1200, orderNumber: 'order-1', amount: '100.00 KZT' })),
    isPaid: (response: VtbOrderStatusResponse) => String(response.errorCode ?? '0') === '0' && response.orderStatus === 2,
    ...overrides,
  } as unknown as VtbClient;
}

describe('PaymentsService', () => {
  beforeEach(() => {
    process.env.FRONTEND_BASE_URL = 'http://localhost:5173';
    process.env.PUBLIC_API_BASE_URL = 'http://localhost:8080';
    delete process.env.VTB_DYNAMIC_CALLBACK_URL;
    process.env.VTB_CURRENCY = '398';
    process.env.VTB_KZT_MINOR_UNITS_PER_OWK = '100';
    process.env.VTB_SESSION_TIMEOUT_SECONDS = '1200';
  });

  it('converts OWK credits into VTB minor currency units', async () => {
    process.env.VTB_KZT_MINOR_UNITS_PER_OWK = '250';
    const db = new InMemoryDb();
    const user = insertUser(db);
    const vtb = fakeVtb();
    const service = new PaymentsService(db as never, vtb);

    const result = await service.createVtbOrder(user, { amount: 10 });
    const row = db.get<PaymentOrderRow>('SELECT * FROM payment_orders WHERE uid = ?', [result.order_uid])!;

    expect(result.amount_minor).toBe(2500);
    expect(row.amount_minor).toBe(2500);
    expect(vtb.registerOrder).toHaveBeenCalledWith(expect.objectContaining({ amountMinor: 2500 }));
  });

  it('does not send a plain HTTP dynamic callback URL to VTB', async () => {
    process.env.PUBLIC_API_BASE_URL = 'http://188.244.115.77';
    process.env.VTB_DYNAMIC_CALLBACK_URL = 'http://188.244.115.77/api/payments/vtb/callback';
    const db = new InMemoryDb();
    const user = insertUser(db);
    const vtb = fakeVtb();
    const service = new PaymentsService(db as never, vtb);

    await service.createVtbOrder(user, { amount: 10 });

    expect(vtb.registerOrder).toHaveBeenCalledWith(expect.objectContaining({ callbackUrl: undefined }));
  });

  it('sends HTTPS dynamic callback URL to VTB', async () => {
    process.env.PUBLIC_API_BASE_URL = 'https://oldwhale.net';
    const db = new InMemoryDb();
    const user = insertUser(db);
    const vtb = fakeVtb();
    const service = new PaymentsService(db as never, vtb);

    await service.createVtbOrder(user, { amount: 10 });

    expect(vtb.registerOrder).toHaveBeenCalledWith(
      expect.objectContaining({ callbackUrl: 'https://oldwhale.net/api/payments/vtb/callback' }),
    );
  });

  it('marks local orders failed when VTB registration fails', async () => {
    const db = new InMemoryDb();
    const user = insertUser(db);
    const vtb = fakeVtb({
      registerOrder: jest.fn(async (input: VtbRegisterOrderInput) => ({
        request: { amount: input.amountMinor, orderNumber: input.orderNumber },
        response: { errorCode: '1', errorMessage: 'duplicate order' },
      })),
    });
    const service = new PaymentsService(db as never, vtb);

    await expect(service.createVtbOrder(user, { amount: 10 })).rejects.toMatchObject({ response: { error: 'duplicate order' } });
    const row = db.get<PaymentOrderRow>('SELECT * FROM payment_orders LIMIT 1')!;

    expect(row.status).toBe('failed');
    expect(row.raw_register_response_json).toContain('duplicate order');
  });

  it('credits a paid order exactly once', async () => {
    const db = new InMemoryDb();
    const user = insertUser(db, 5);
    let orderNumber = '';
    const vtb = fakeVtb({
      registerOrder: jest.fn(async (input: VtbRegisterOrderInput) => {
        orderNumber = input.orderNumber;
        return {
          request: { amount: input.amountMinor, orderNumber: input.orderNumber },
          response: { orderId: 'vtb-order-1', formUrl: 'https://vtb.example/form' },
        };
      }),
      getOrderStatus: jest.fn(async () => ({
        errorCode: '0',
        errorMessage: 'Success',
        orderNumber,
        orderStatus: 2,
        amount: 1000,
        currency: '398',
      })),
    });
    const service = new PaymentsService(db as never, vtb);
    const created = await service.createVtbOrder(user, { amount: 10 });

    await service.refreshOrderForUser(created.order_uid, user);
    await service.refreshOrderForUser(created.order_uid, user);
    const balance = db.get<{ credits: number }>('SELECT credits FROM users WHERE uid = ?', [user.uid])?.credits;
    const row = db.get<PaymentOrderRow>('SELECT * FROM payment_orders WHERE uid = ?', [created.order_uid])!;

    expect(balance).toBe(15);
    expect(row.status).toBe('paid');
    expect(row.credited_at).toBeTruthy();
  });
});
