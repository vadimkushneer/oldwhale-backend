import { Body, Controller, Get, HttpCode, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { badRequest } from '../common/http-error';
import type { PublicUser } from '../users/users.types';
import { PaymentsService } from './payments.service';

function mergeParams(query: Record<string, unknown>, body: Record<string, unknown> | undefined): Record<string, unknown> {
  return { ...query, ...(body ?? {}) };
}

@Controller('api/payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('vtb/orders')
  @UseGuards(JwtAuthGuard)
  createVtbOrder(@CurrentUser() user: PublicUser, @Body() body: { amount?: number }) {
    return this.payments.createVtbOrder(user, body);
  }

  @Get('orders/:uid')
  @UseGuards(JwtAuthGuard)
  getOrder(@CurrentUser() user: PublicUser, @Param('uid') uid: string) {
    return this.payments.getOrderForUser(uid, user);
  }

  @Post('orders/:uid/refresh')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  refreshOrder(@CurrentUser() user: PublicUser, @Param('uid') uid: string) {
    return this.payments.refreshOrderForUser(uid, user);
  }

  @Get('vtb/return')
  async vtbReturn(
    @Query() query: Record<string, unknown>,
    @Res() response: Response,
  ): Promise<void> {
    const orderUid = stringParam(query.order_uid);
    const vtbOrderId = stringParam(query.orderId) || stringParam(query.orderID) || stringParam(query.mdOrder);
    const orderNumber = stringParam(query.orderNumber);
    if (!orderUid && !vtbOrderId && !orderNumber) badRequest('payment order id is required');
    const result = await this.payments.handleReturn({
      orderUid,
      vtbOrderId,
      orderNumber,
      failed: stringParam(query.failed) === '1',
    });
    response.redirect(result.redirectUrl);
  }

  @Get('vtb/callback')
  vtbCallbackGet(@Query() query: Record<string, unknown>) {
    return this.payments.handleVtbCallback(query);
  }

  @Post('vtb/callback')
  @HttpCode(200)
  vtbCallbackPost(@Query() query: Record<string, unknown>, @Body() body: Record<string, unknown>) {
    return this.payments.handleVtbCallback(mergeParams(query, body));
  }
}

function stringParam(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}
