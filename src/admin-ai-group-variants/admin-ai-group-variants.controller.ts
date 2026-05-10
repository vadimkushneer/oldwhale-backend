import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiFacade } from '../api/api.facade';
import type { JsonBody } from '../api/api.facade';
import { AdminGuard } from '../security/admin.guard';

@Controller('api/admin/ai/groups/:uid/variants')
@UseGuards(AdminGuard)
export class AdminAiGroupVariantsController {
  constructor(private readonly api: ApiFacade) {}

  @Post()
  create(@Param('uid') uid: string, @Body() body: JsonBody): Promise<JsonBody> {
    return this.api.createVariant(uid, body);
  }
}
