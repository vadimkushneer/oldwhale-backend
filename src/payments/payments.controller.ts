import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AdminGuard, JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { PublicUser } from '../users/users.types';
import { PaymentsService } from './payments.service';

/** Customer-facing top-up endpoints (require a valid session). */
@Controller('api/me/payments')
@UseGuards(JwtAuthGuard)
export class MePaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /** Registers an order on the gateway; returns `{ formUrl }` to redirect to. */
  @Post()
  @HttpCode(201)
  create(@CurrentUser() user: PublicUser, @Body() body: { credits?: number; amount?: number }) {
    return this.payments.createPayment(user, body?.credits ?? body?.amount);
  }

  @Get()
  list(@CurrentUser() user: PublicUser) {
    return { payments: this.payments.listForUser(user) };
  }

  @Get(':uid')
  getOne(@CurrentUser() user: PublicUser, @Param('uid') uid: string) {
    return this.payments.getForUser(user, uid);
  }

  /** Re-checks the authoritative gateway status and grants credits if paid. */
  @Post(':uid/sync')
  @HttpCode(200)
  sync(@CurrentUser() user: PublicUser, @Param('uid') uid: string) {
    return this.payments.syncPayment(user, uid);
  }
}

/** Public gateway webhook. No auth: authenticity comes from checksum + re-check. */
@Controller('api/payments/vtb')
export class PaymentsCallbackController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('callback')
  @HttpCode(200)
  async callbackPost(@Body() body: Record<string, unknown>, @Query() query: Record<string, unknown>) {
    await this.payments.handleCallback({ ...query, ...body });
    return 'OK';
  }

  @Get('callback')
  @HttpCode(200)
  async callbackGet(@Query() query: Record<string, unknown>) {
    await this.payments.handleCallback(query);
    return 'OK';
  }
}

/** Admin forensics: inspect any payment and its full audit trail. */
@Controller('api/admin/payments')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminPaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get()
  list(@Query() query: Record<string, unknown>) {
    return this.payments.listAll(query);
  }

  @Get(':uid/events')
  events(@Param('uid') uid: string) {
    return this.payments.eventsFor(uid);
  }
}
