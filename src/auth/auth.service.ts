import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { badRequest, forbidden, unauthorized } from '../common/http-error';
import { JwtService } from '../security/jwt.service';
import { verifyPassword } from '../security/password';
import { UsersService } from '../users/users.service';
import type { PublicUser } from '../users/users.types';

@Injectable()
export class AuthService {
  constructor(private readonly users: UsersService, private readonly jwt: JwtService) {}

  register(input: { username?: string; login?: string; email?: string; password?: string }): { token: string; user: PublicUser } {
    if (!input.email || !input.password) badRequest('Email and password are required');
    const user = this.users.create({ username: input.username, login: input.login, email: input.email, password: input.password, role: 'user' });
    return { token: this.jwt.sign({ sub: user.uid, role: user.role }), user };
  }

  login(input: { username?: string; login?: string; password?: string }): { token: string; user: PublicUser } {
    const username = (input.username ?? input.login ?? '').trim();
    if (!username || !input.password) badRequest('Username and password are required');
    const row = this.users.findRowByUsername(username);
    if (!row || !verifyPassword(input.password, row.password_hash)) unauthorized('Invalid username or password');
    if (row.disabled) forbidden('User is disabled');
    this.users.markLogin(row.uid);
    const fresh = this.users.findByUid(row.uid)!;
    return { token: this.jwt.sign({ sub: fresh.uid, role: fresh.role }), user: fresh };
  }

  userFromRequest(request: Request): PublicUser | null {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) return null;
    const payload = this.jwt.verify(header.slice('Bearer '.length).trim());
    if (!payload) return null;
    const user = this.users.findByUid(payload.sub);
    if (!user || user.disabled) return null;
    return user;
  }
}
