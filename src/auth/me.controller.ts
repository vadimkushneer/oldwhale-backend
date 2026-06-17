import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from './current-user.decorator';
import { JwtAuthGuard } from './auth.guard';
import { badRequest, serviceUnavailable } from '../common/http-error';
import { isVtbConfigured } from '../config/env';
import { UsersService } from '../users/users.service';
import type { PublicUser } from '../users/users.types';

/** Largest single top-up accepted from the client (guards against overflow / typos). */
const MAX_TOPUP_AMOUNT = 100_000;

@Controller('api/me')
export class MeController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: PublicUser) {
    return user;
  }

  /**
   * Adds credits (Krill / OWK) without a payment gateway. Disabled when VTB is
   * configured — use POST /api/me/payments instead.
   */
  @Post('credits/topup')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  topUp(@CurrentUser() user: PublicUser, @Body() body: { amount?: number }) {
    if (isVtbConfigured()) {
      serviceUnavailable('Use POST /api/me/payments to top up via the payment gateway');
    }
    const amount = Math.trunc(Number(body?.amount));
    if (!Number.isFinite(amount) || amount <= 0) badRequest('amount must be a positive number');
    if (amount > MAX_TOPUP_AMOUNT) badRequest(`amount must not exceed ${MAX_TOPUP_AMOUNT}`);
    return this.users.addCredits(user.uid, amount);
  }
}
