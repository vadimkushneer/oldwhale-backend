import crypto from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { SqliteService } from '../database/sqlite.service';
import { conflict, notFound } from '../common/http-error';
import { boolFromDb, nowIso } from '../common/time';
import { hashPassword } from '../security/password';
import type { PublicUser, UserRole, UserRow } from './users.types';

export interface CreateUserInput {
  username?: string;
  login?: string;
  email: string;
  password: string;
  role?: UserRole;
}

@Injectable()
export class UsersService {
  constructor(private readonly db: SqliteService) {}

  toPublic(row: UserRow): PublicUser {
    return {
      id: Number(row.id),
      uid: row.uid,
      login: row.username,
      username: row.username,
      email: row.email,
      role: row.role,
      disabled: boolFromDb(row.disabled),
      last_login_at: row.last_login_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  list(): PublicUser[] {
    return this.db
      .all<UserRow>('SELECT * FROM users ORDER BY id ASC')
      .map((row) => this.toPublic(row));
  }

  findRowByUid(uid: string): UserRow | undefined {
    return this.db.get<UserRow>('SELECT * FROM users WHERE uid = ?', [uid]);
  }

  findRowByUsername(username: string): UserRow | undefined {
    return this.db.get<UserRow>('SELECT * FROM users WHERE username = ?', [username]);
  }

  findByUid(uid: string): PublicUser | undefined {
    const row = this.findRowByUid(uid);
    return row ? this.toPublic(row) : undefined;
  }

  findByIdOrUid(idOrUid: string): PublicUser {
    const row = /^\d+$/.test(idOrUid)
      ? this.db.get<UserRow>('SELECT * FROM users WHERE id = ?', [Number(idOrUid)])
      : this.findRowByUid(idOrUid);
    if (!row) notFound(`user "${idOrUid}" not found`);
    return this.toPublic(row);
  }

  create(input: CreateUserInput): PublicUser {
    const username = (input.username ?? input.login ?? '').trim();
    const email = input.email.trim().toLowerCase();
    if (username.length < 2) conflict('Username must be at least 2 characters');
    if (!email.includes('@')) conflict('Email is invalid');
    if (input.password.length < 4) conflict('Password must be at least 4 characters');
    const now = nowIso();
    try {
      this.db.run(
        `INSERT INTO users (uid, username, email, password_hash, role, disabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
        [crypto.randomUUID(), username, email, hashPassword(input.password), input.role ?? 'user', now, now],
      );
    } catch (error) {
      if (String(error).includes('UNIQUE')) conflict('Username or email already exists');
      throw error;
    }
    return this.toPublic(this.findRowByUsername(username)!);
  }

  patch(idOrUid: string, patch: { disabled?: boolean; role?: UserRole }): PublicUser {
    const user = this.findByIdOrUid(idOrUid);
    const disabled = patch.disabled === undefined ? user.disabled : patch.disabled;
    const role = patch.role ?? user.role;
    this.db.run('UPDATE users SET disabled = ?, role = ?, updated_at = ? WHERE uid = ?', [disabled ? 1 : 0, role, nowIso(), user.uid]);
    return this.toPublic(this.findRowByUid(user.uid)!);
  }

  delete(idOrUid: string): void {
    const user = this.findByIdOrUid(idOrUid);
    this.db.run('DELETE FROM users WHERE uid = ?', [user.uid]);
  }

  markLogin(uid: string): void {
    const now = nowIso();
    this.db.run('UPDATE users SET last_login_at = ?, updated_at = ? WHERE uid = ?', [now, now, uid]);
  }
}
