import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { badRequest, forbidden, unauthorized } from '../common/http-error';
import { JwtService } from '../security/jwt.service';
import { verifyPassword } from '../security/password';
import { UsersService } from '../users/users.service';
import type { PublicUser } from '../users/users.types';
import { RegistrationOtpService } from './registration-otp.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly registrationOtp: RegistrationOtpService,
  ) {}

  register(input: { email?: string; password?: string; setupToken?: string }): { token: string; user: PublicUser } {
    return this.completeRegistration(input);
  }

  requestRegistrationOtp(input: { email?: string }): Promise<{ ok: true; expiresInSeconds: number }> {
    return this.registrationOtp.requestOtp(input);
  }

  verifyRegistrationOtp(input: { email?: string; otp?: string }): { setupToken: string; expiresInSeconds: number } {
    return this.registrationOtp.verifyOtp(input);
  }

  completeRegistration(input: { email?: string; password?: string; setupToken?: string }): { token: string; user: PublicUser } {
    if (!input.password) badRequest('Password is required');
    const email = this.registrationOtp.consumeSetupToken(input);
    const user = this.users.createFromVerifiedEmail(email, input.password);
    this.registrationOtp.deletePending(email);
    return { token: this.jwt.sign({ sub: user.uid, role: user.role }), user };
  }

  login(input: { username?: string; login?: string; password?: string }): { token: string; user: PublicUser } {
    const username = (input.username ?? input.login ?? '').trim();
    if (!username || !input.password) badRequest('Username/email and password are required');
    const row = this.users.findRowByUsernameOrEmail(username);
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
