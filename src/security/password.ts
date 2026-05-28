import crypto from 'node:crypto';

const PREFIX = 'scrypt';
const KEY_LENGTH = 64;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('base64url');
  const key = crypto.scryptSync(password, salt, KEY_LENGTH).toString('base64url');
  return `${PREFIX}$${salt}$${key}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [prefix, salt, key] = storedHash.split('$');
  if (prefix !== PREFIX || !salt || !key) return false;
  const candidate = crypto.scryptSync(password, salt, KEY_LENGTH);
  const expected = Buffer.from(key, 'base64url');
  return expected.length === candidate.length && crypto.timingSafeEqual(expected, candidate);
}
