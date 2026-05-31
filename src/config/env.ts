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
