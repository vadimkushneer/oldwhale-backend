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

export function corsOrigin(): boolean | string[] {
  const origin = process.env.CORS_ORIGIN;
  if (!origin) return true;
  return origin
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
