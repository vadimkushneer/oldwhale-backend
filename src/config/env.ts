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

export function readPublicApiBaseUrl(): string {
  const explicit = readEnv('PUBLIC_API_BASE_URL').replace(/\/+$/, '');
  if (explicit) return explicit;
  return `http://localhost:${readPort()}`;
}

export function readVtbApiBaseUrl(): string {
  return readEnv('VTB_API_BASE_URL', 'https://vtbkz.rbsuat.com/payment/rest/').replace(/\/?$/, '/');
}

export function readVtbUserName(): string {
  return readEnv('VTB_USER_NAME', 'Oldwhale-api');
}

export function readVtbPassword(): string {
  return readEnv('VTB_PASSWORD', 'Oldwhale');
}

export function readVtbToken(): string {
  return readEnv('VTB_TOKEN');
}

export function readVtbCurrency(): string {
  return readEnv('VTB_CURRENCY', '398').trim() || '398';
}

export function readVtbLanguage(): string {
  return readEnv('VTB_LANGUAGE', 'ru').trim() || 'ru';
}

export function readVtbDynamicCallbackUrl(): string {
  return readEnv('VTB_DYNAMIC_CALLBACK_URL').trim();
}

/** Minor KZT units charged per 1 OWK credit. Default: 100 tiyn = 1.00 KZT. */
export function readVtbMinorUnitsPerOwk(): number {
  const raw = readEnv('VTB_KZT_MINOR_UNITS_PER_OWK', '100');
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 100;
}

export function readVtbSessionTimeoutSeconds(): number {
  const raw = readEnv('VTB_SESSION_TIMEOUT_SECONDS', '1200');
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 1200;
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
