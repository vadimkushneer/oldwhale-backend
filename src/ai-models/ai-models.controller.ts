import { Controller, Get } from '@nestjs/common';
import { ApiFacade } from '../api/api.facade';
import type { JsonBody } from '../api/api.facade';

@Controller('api/ai/models')
export class AiModelsController {
  constructor(private readonly api: ApiFacade) {}

  @Get()
  findAll(): Promise<JsonBody> {
    return this.api.listPublicModels();
  }
}
