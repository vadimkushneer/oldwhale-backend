import { Body, Controller, Get, HttpCode, Logger, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from './current-user.decorator';
import { JwtAuthGuard } from './auth.guard';
import { badRequest, forbidden } from '../common/http-error';
import { readDevFreeTopupEnabled } from '../config/env';
import { UsersService } from '../users/users.service';
import type { PublicUser } from '../users/users.types';

/** Largest single top-up accepted from the client (guards against overflow / typos). */
const MAX_TOPUP_AMOUNT = 100_000;

@Controller('api/me')
export class MeController {
  private readonly logger = new Logger('MeController');

  constructor(private readonly users: UsersService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: PublicUser) {
    return user;
  }

  /**
   * DEV-ONLY free credit grant. Real top-ups go through the VTB payment flow
   * (`POST /api/me/payments`). This endpoint mints credits without payment, so
   * it is disabled unless `DEV_FREE_TOPUP_ENABLED` is set — production must
   * never expose a way to grant free credits.
   */
  @Post('credits/topup')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  topUp(@CurrentUser() user: PublicUser, @Body() body: { amount?: number }) {
    if (!readDevFreeTopupEnabled()) {
      this.logger.warn(`blocked free top-up attempt by user ${user.uid}; use /api/me/payments instead`);
      forbidden('Free top-up is disabled. Use the payment flow.');
    }
    const amount = Math.trunc(Number(body?.amount));
    if (!Number.isFinite(amount) || amount <= 0) badRequest('amount must be a positive number');
    if (amount > MAX_TOPUP_AMOUNT) badRequest(`amount must not exceed ${MAX_TOPUP_AMOUNT}`);
    this.logger.warn(`DEV free top-up: +${amount} OWK to user ${user.uid}`);
    return this.users.addCredits(user.uid, amount);
  }
}
