import { Controller, Get, HttpCode, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { PaymentsService } from './payments.service';

@Controller('api/payments/vtb')
export class VtbCallbackController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('callback')
  @HttpCode(200)
  callbackGet(@Query() query: Record<string, string>) {
    this.payments.handleCallback(query);
    return { ok: true };
  }

  @Post('callback')
  @HttpCode(200)
  callbackPost(@Req() req: Request, @Query() query: Record<string, string>) {
    const body = (req.body ?? {}) as Record<string, string>;
    this.payments.handleCallback({ ...query, ...body });
    return { ok: true };
  }
}
