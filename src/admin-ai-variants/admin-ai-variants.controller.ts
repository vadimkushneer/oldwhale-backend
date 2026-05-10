import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { ApiFacade } from '../api/api.facade';
import type { JsonBody } from '../api/api.facade';
import { AdminGuard } from '../security/admin.guard';

@Controller('api/admin/ai/variants')
@UseGuards(AdminGuard)
export class AdminAiVariantsController {
  constructor(private readonly api: ApiFacade) {}

  @Patch(':uid')
  update(@Param('uid') uid: string, @Body() body: JsonBody): Promise<JsonBody> {
    return this.api.patchVariant(uid, body);
  }

  @Delete(':uid')
  @HttpCode(204)
  remove(@Param('uid') uid: string): Promise<void> {
    return this.api.deleteVariant(uid);
  }
}
