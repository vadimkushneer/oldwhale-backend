import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiFacade } from '../api/api.facade';
import type { JsonBody } from '../api/api.facade';
import { AdminGuard } from '../security/admin.guard';

@Controller('api/admin/ai/model-providers')
@UseGuards(AdminGuard)
export class AdminAiModelProvidersController {
  constructor(private readonly api: ApiFacade) {}

  @Get()
  findAll(): JsonBody {
    return this.api.modelProviders();
  }
}
