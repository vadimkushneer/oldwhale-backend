import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/auth.guard';
import { badRequest } from '../common/http-error';
import type { PublicUser } from '../users/users.types';
import { PaymentsService } from './payments.service';

@Controller('api/me/payments')
@UseGuards(JwtAuthGuard)
export class MePaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post()
  @HttpCode(200)
  create(@CurrentUser() user: PublicUser, @Body() body: { credits?: number }) {
    const credits = Math.trunc(Number(body?.credits));
    if (!Number.isFinite(credits) || credits <= 0) badRequest('credits must be a positive number');
    return this.payments.createPayment(user.uid, credits);
  }

  @Get(':id')
  get(@CurrentUser() user: PublicUser, @Param('id') id: string) {
    return this.payments.getPaymentForUser(user.uid, id);
  }

  @Post(':id/sync')
  @HttpCode(200)
  sync(@CurrentUser() user: PublicUser, @Param('id') id: string) {
    return this.payments.syncPayment(user.uid, id);
  }
}
