import {
  Body,
  Controller,
  HttpCode,
  Param,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiFacade } from '../api/api.facade';
import type { JsonBody } from '../api/api.facade';
import { AdminGuard } from '../security/admin.guard';

@Controller('api/admin/ai/groups/:uid/variants/order')
@UseGuards(AdminGuard)
export class AdminAiGroupVariantsOrderController {
  constructor(private readonly api: ApiFacade) {}

  @Put()
  @HttpCode(204)
  put(@Param('uid') uid: string, @Body() body: JsonBody): Promise<void> {
    return this.api.reorderVariants(uid, body);
  }
}
