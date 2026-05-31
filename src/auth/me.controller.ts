import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from './current-user.decorator';
import { JwtAuthGuard } from './auth.guard';
import { badRequest } from '../common/http-error';
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
   * Adds credits (Krill / OWK) to the current account. This stands in for a real
   * payment provider — the purchase itself is out of scope, so the endpoint simply
   * grants the requested amount and returns the refreshed account.
   */
  @Post('credits/topup')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  topUp(@CurrentUser() user: PublicUser, @Body() body: { amount?: number }) {
    const amount = Math.trunc(Number(body?.amount));
    if (!Number.isFinite(amount) || amount <= 0) badRequest('amount must be a positive number');
    if (amount > MAX_TOPUP_AMOUNT) badRequest(`amount must not exceed ${MAX_TOPUP_AMOUNT}`);
    return this.users.addCredits(user.uid, amount);
  }
}
