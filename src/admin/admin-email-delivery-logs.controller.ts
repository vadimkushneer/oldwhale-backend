import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AdminGuard, JwtAuthGuard } from '../auth/auth.guard';
import { EmailDeliveryLogService } from '../auth/email-delivery-log.service';

@Controller('api/admin/email-delivery-logs')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminEmailDeliveryLogsController {
  constructor(private readonly emailLogs: EmailDeliveryLogService) {}

  @Get()
  list(@Query() query: Record<string, unknown>) {
    return this.emailLogs.list(query);
  }
}
