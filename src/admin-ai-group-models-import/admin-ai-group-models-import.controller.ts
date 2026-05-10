import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiFacade } from '../api/api.facade';
import type { JsonBody } from '../api/api.facade';
import { AdminGuard } from '../security/admin.guard';

@Controller('api/admin/ai/groups/:uid/models/import')
@UseGuards(AdminGuard)
export class AdminAiGroupModelsImportController {
  constructor(private readonly api: ApiFacade) {}

  @Post()
  import(@Param('uid') uid: string, @Body() body: JsonBody): Promise<JsonBody> {
    return this.api.importModels(uid, body);
  }
}
