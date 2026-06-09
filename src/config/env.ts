import { join } from 'node:path';

export function readEnv(name: string, fallback = ''): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

export function readPort(): number {
  const raw = readEnv('PORT', '8080');
  const port = Number(raw);
  return Number.isFinite(port) && port > 0 ? port : 8080;
}

export function readSqlitePath(): string {
  return readEnv('SQLITE_PATH', join(process.cwd(), 'data', 'oldwhale.sqlite'));
}

export function readJwtSecret(): string {
  return readEnv('JWT_SECRET', 'local-dev-change-me-to-32-chars-min!!');
}

export function readJwtTtlSeconds(): number {
  const raw = readEnv('JWT_TTL', '24h').trim();
  const match = raw.match(/^(\d+)([smhd])?$/i);
  if (!match) return 24 * 60 * 60;
  const value = Number(match[1]);
  const unit = (match[2] || 's').toLowerCase();
  const factor: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return value * factor[unit];
}

/** Credits (Krill / OWK) granted to a newly created account. */
export function readDefaultUserCredits(): number {
  const raw = readEnv('DEFAULT_USER_CREDITS', '300');
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 300;
}

export function readRegistrationOtpTtlSeconds(): number {
  const raw = readEnv('REGISTRATION_OTP_TTL_SECONDS', '600');
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : 600;
}

export function readRegistrationSetupTtlSeconds(): number {
  const raw = readEnv('REGISTRATION_SETUP_TTL_SECONDS', '900');
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : 900;
}

export function readPasswordResetTtlSeconds(): number {
  const raw = readEnv('PASSWORD_RESET_TTL_SECONDS', '3600');
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : 3600;
}

export function readFrontendBaseUrl(): string {
  const explicit = readEnv('FRONTEND_BASE_URL').replace(/\/+$/, '');
  if (explicit) return explicit;
  const firstBrowserOrigin = corsOriginValue()
    .split(',')
    .map((item) => item.trim())
    .find((item) => /^https?:\/\//i.test(item));
  return (firstBrowserOrigin || 'http://localhost:5173').replace(/\/+$/, '');
}

export function corsOrigin(): boolean | string[] {
  const origin = corsOriginValue();
  if (!origin) return true;
  return origin
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function corsOriginValue(): string {
  return process.env.CORS_ORIGIN ?? '';
}

/* ------------------------------------------------------------------ */
/* VTB Kazakhstan eCommerce gateway (RBS platform) payment integration */
/* ------------------------------------------------------------------ */

/** REST base URL of the gateway, trailing slash guaranteed. Sandbox by default. */
export function readVtbApiBaseUrl(): string {
  const raw = readEnv('VTB_API_BASE_URL', 'https://vtbkz.rbsuat.com/payment/rest/').trim();
  return raw.endsWith('/') ? raw : `${raw}/`;
}

/** Merchant API login (`-api` account). Empty when not configured. */
export function readVtbApiUserName(): string {
  return readEnv('VTB_API_USERNAME').trim();
}

/** Merchant API password. Empty when not configured. */
export function readVtbApiPassword(): string {
  return readEnv('VTB_API_PASSWORD').trim();
}

/** Optional open token used instead of userName/password. */
export function readVtbApiToken(): string {
  return readEnv('VTB_API_TOKEN').trim();
}

/** ISO 4217 numeric currency code. KZT (398) by default. */
export function readVtbCurrency(): string {
  return readEnv('VTB_CURRENCY', '398').trim();
}

/**
 * Minor currency units per 1 OWK credit. The product rule is 1 OWK = 1 KZT and
 * KZT has 100 tiyin, so the gateway `amount` is `credits * 100`.
 */
export function readVtbMinorUnitsPerCredit(): number {
  const raw = readEnv('VTB_MINOR_UNITS_PER_CREDIT', '100');
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 100;
}

/** Payment page language (ISO 639-1): ru, en, hy, az. */
export function readVtbLanguage(): string {
  const raw = readEnv('VTB_LANGUAGE', 'ru').trim().toLowerCase();
  return /^(ru|en|hy|az)$/.test(raw) ? raw : 'ru';
}

/** Order lifetime in seconds passed to register.do (gateway default 1200). */
export function readVtbSessionTimeoutSecs(): number {
  const raw = readEnv('VTB_SESSION_TIMEOUT_SECS', '1200');
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 1200;
}

/** Optional shared symmetric key for HMAC-SHA256 callback checksum verification. */
export function readVtbCallbackChecksumKey(): string {
  return readEnv('VTB_CALLBACK_CHECKSUM_KEY').trim();
}

/**
 * Public, internet-reachable base URL of THIS backend, used to build the
 * per-order `dynamicCallbackUrl`. When empty no dynamic callback URL is sent
 * (the gateway may still use a statically configured callback).
 */
export function readPublicApiBaseUrl(): string {
  return readEnv('PUBLIC_API_BASE_URL').replace(/\/+$/, '');
}

/** SPA path the gateway returns the payer to; the local payment id is appended. */
export function readVtbReturnPath(): string {
  const raw = readEnv('VTB_RETURN_PATH', '/payment/return').trim();
  return raw.startsWith('/') ? raw : `/${raw}`;
}

/** Network timeout (ms) for gateway HTTP calls. */
export function readVtbHttpTimeoutMs(): number {
  const raw = readEnv('VTB_HTTP_TIMEOUT_MS', '15000');
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 15000;
}

/** True when enough is configured to talk to the gateway. */
export function isVtbConfigured(): boolean {
  const hasUserPass = Boolean(readVtbApiUserName() && readVtbApiPassword());
  const hasToken = Boolean(readVtbApiToken());
  return Boolean(readVtbApiBaseUrl()) && (hasUserPass || hasToken);
}

/**
 * When true, the legacy `POST /api/me/credits/topup` endpoint grants credits
 * for free (no gateway). Intended ONLY for local development without VTB
 * credentials; disabled by default so production cannot mint free credits.
 */
export function readDevFreeTopupEnabled(): boolean {
  return /^(1|true|yes)$/i.test(readEnv('DEV_FREE_TOPUP_ENABLED', '').trim());
}
