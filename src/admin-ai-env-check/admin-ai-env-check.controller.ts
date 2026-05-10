import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiFacade } from '../api/api.facade';
import type { JsonBody } from '../api/api.facade';
import { AdminGuard } from '../security/admin.guard';

@Controller('api/admin/ai/env-check')
@UseGuards(AdminGuard)
export class AdminAiEnvCheckController {
  constructor(private readonly api: ApiFacade) {}

  @Post()
  check(@Body() body: JsonBody): JsonBody {
    return this.api.envCheck(body);
  }
}
