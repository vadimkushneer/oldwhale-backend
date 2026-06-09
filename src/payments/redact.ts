/** Keys whose values must never reach logs, the audit table, or the browser. */
const SECRET_KEYS = new Set([
  'password',
  'token',
  'cvc',
  'cvv',
  'cvc2',
  'pan',
  'cardnumber',
  'authorization',
  'vtb_api_password',
  'vtb_api_token',
  'vtb_callback_checksum_key',
]);

/**
 * Deep-clones a value while masking any property whose (lower-cased) name is a
 * known secret. Used before persisting/logging gateway requests or responses so
 * credentials and card data are never written anywhere durable. `maskedPan`
 * (already masked by the gateway) is intentionally allowed through.
 */
export function redactSecrets(value: unknown, seen = new WeakSet<object>()): unknown {
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item, seen));
  if (value && typeof value === 'object') {
    if (seen.has(value as object)) return '[circular]';
    seen.add(value as object);
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEYS.has(key.toLowerCase()) ? '***' : redactSecrets(val, seen);
    }
    return out;
  }
  return value;
}

/** Normalizes any thrown value into a compact, log-safe summary. */
export function summarizeError(error: unknown): { name: string; message: string; stack?: string } {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return { name: 'NonError', message: typeof error === 'string' ? error : JSON.stringify(error) };
}
