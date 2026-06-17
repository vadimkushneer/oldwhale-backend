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
/* Hosting auto-deploy branch configuration                           */
/* ------------------------------------------------------------------ */

/** JSON file read by the backend API and the server deploy script. */
export function readHostingDeployBranchesPath(): string {
  return readEnv('HOSTING_DEPLOY_BRANCHES_PATH', join(process.cwd(), 'data', 'deploy-branches.json'));
}

/** Optional GitHub token for listing remote branches (higher rate limits). */
export function readGithubToken(): string {
  return readEnv('GITHUB_TOKEN').trim();
}

export function readHostingBackendRepo(): string {
  return readEnv('HOSTING_BACKEND_REPO', 'vadimkushneer/oldwhale-backend');
}

export function readHostingFrontendRepo(): string {
  return readEnv('HOSTING_FRONTEND_REPO', 'vadimkushneer/oldwhale-frontend');
}

/* ------------------------------------------------------------------ */
/* VTB KZ payment gateway (RBS redirect integration)                  */
/* ------------------------------------------------------------------ */

/** Sandbox: https://vtbkz.rbsuat.com/payment/rest/ — production: https://payment.vtb.kz/payment/rest/ */
export function readVtbApiBaseUrl(): string {
  const raw = readEnv('VTB_API_BASE_URL', 'https://vtbkz.rbsuat.com/payment/rest/').trim();
  return raw.endsWith('/') ? raw : `${raw}/`;
}

export function readVtbMerchantUsername(): string {
  return readEnv('VTB_MERCHANT_USERNAME').trim() || readEnv('VTB_API_USERNAME').trim();
}

export function readVtbMerchantPassword(): string {
  return readEnv('VTB_MERCHANT_PASSWORD').trim() || readEnv('VTB_API_PASSWORD').trim();
}

/** Optional HMAC key for verifying VTB checksum callbacks. */
export function readVtbCallbackSecret(): string {
  return readEnv('VTB_CALLBACK_SECRET').trim();
}

export function isVtbConfigured(): boolean {
  return Boolean(readVtbMerchantUsername() && readVtbMerchantPassword());
}

/** Per-order VTB callback URL; omitted when no public HTTPS origin is configured. */
export function readVtbDynamicCallbackUrl(): string | undefined {
  const explicit = readEnv('VTB_DYNAMIC_CALLBACK_URL').trim();
  if (explicit) return explicit;
  const apiPublic = readEnv('API_PUBLIC_BASE_URL').replace(/\/+$/, '');
  if (apiPublic) return `${apiPublic}/api/payments/vtb/callback`;
  const frontend = readFrontendBaseUrl();
  if (/^https:\/\//i.test(frontend)) {
    return `${frontend}/api/payments/vtb/callback`;
  }
  return undefined;
}

/** Public backend origin used for VTB server callbacks (no trailing slash). */
export function readApiPublicBaseUrl(): string {
  const explicit = readEnv('API_PUBLIC_BASE_URL').replace(/\/+$/, '');
  if (explicit) return explicit;
  const port = readPort();
  return `http://localhost:${port}`;
}
