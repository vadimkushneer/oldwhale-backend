import crypto from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { nowIso } from '../common/time';
import { SqliteService } from '../database/sqlite.service';
import { redactSecrets } from './redact';
import type { PaymentEventLevel } from './payments.types';

/**
 * Records every payment step both to the `payment_events` table (queryable
 * audit trail tied to a payment) and to the process logger (stdout, captured by
 * the hosting platform/Docker). This dual sink is what makes payment failures
 * diagnosable after the fact: pull the container logs OR query the table by
 * payment to reconstruct the exact sequence and the (redacted) gateway payloads.
 */
@Injectable()
export class PaymentEventsService {
  private readonly logger = new Logger('Payments');

  constructor(private readonly db: SqliteService) {}

  /**
   * Persists one audit event and emits a matching structured log line.
   * `detail` is deep-redacted (passwords/tokens/PAN removed) before it is
   * written anywhere.
   */
  record(
    paymentUid: string,
    type: string,
    message: string,
    detail?: unknown,
    level: PaymentEventLevel = 'info',
  ): void {
    const safeDetail = detail === undefined ? null : redactSecrets(detail);
    const detailJson = safeDetail === null ? null : safeJsonStringify(safeDetail);

    try {
      this.db.run(
        `INSERT INTO payment_events (uid, payment_uid, type, level, message, detail_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [crypto.randomUUID(), paymentUid, type, level, message, detailJson, nowIso()],
      );
    } catch (error) {
      // Never let audit persistence break the payment flow; the stdout line below still survives.
      this.logger.error(`[${paymentUid}] failed to persist payment_event ${type}: ${String(error)}`);
    }

    const line = `[payment=${paymentUid}] ${type} — ${message}`;
    const meta = detailJson ?? '';
    if (level === 'error') this.logger.error(`${line} ${meta}`.trim());
    else if (level === 'warn') this.logger.warn(`${line} ${meta}`.trim());
    else this.logger.log(`${line} ${meta}`.trim());
  }

  /** Returns the audit trail for one payment, newest first. */
  list(paymentUid: string): Array<Record<string, unknown>> {
    return this.db.all<Record<string, unknown>>(
      `SELECT type, level, message, detail_json, created_at
       FROM payment_events WHERE payment_uid = ? ORDER BY id DESC`,
      [paymentUid],
    );
  }
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '"[unserializable]"';
  }
}
