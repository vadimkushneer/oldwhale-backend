import crypto from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { readJwtSecret, readJwtTtlSeconds } from '../config/env';

export interface JwtPayload {
  sub: string;
  role: 'user' | 'admin';
  exp: number;
  iat: number;
}

function b64(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

@Injectable()
export class JwtService {
  sign(payload: Pick<JwtPayload, 'sub' | 'role'>): string {
    const now = Math.floor(Date.now() / 1000);
    const full: JwtPayload = { ...payload, iat: now, exp: now + readJwtTtlSeconds() };
    const header = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const body = b64(JSON.stringify(full));
    const signature = this.signature(`${header}.${body}`);
    return `${header}.${body}.${signature}`;
  }

  verify(token: string): JwtPayload | null {
    const [header, body, signature] = token.split('.');
    if (!header || !body || !signature) return null;
    const expected = this.signature(`${header}.${body}`);
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as JwtPayload;
    if (!parsed.sub || parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return parsed;
  }

  private signature(data: string): string {
    return crypto.createHmac('sha256', readJwtSecret()).update(data).digest('base64url');
  }
}
