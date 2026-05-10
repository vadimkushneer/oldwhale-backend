import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiFacade } from '../api/api.facade';
import type { JsonBody } from '../api/api.facade';
import { AdminGuard } from '../security/admin.guard';

@Controller('api/admin/ai/chat-logs')
@UseGuards(AdminGuard)
export class AdminAiChatLogsController {
  constructor(private readonly api: ApiFacade) {}

  @Get()
  findAll(@Query() query: JsonBody): Promise<JsonBody> {
    return this.api.listChatLogs(query);
  }
}
