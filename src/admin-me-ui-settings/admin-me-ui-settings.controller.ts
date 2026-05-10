import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import { ApiFacade } from '../api/api.facade';
import type { JsonBody } from '../api/api.facade';
import { AdminGuard } from '../security/admin.guard';
import type { RequestWithUser } from '../security/request-with-user';

@Controller('api/admin/me/ui-settings')
@UseGuards(AdminGuard)
export class AdminMeUiSettingsController {
  constructor(private readonly api: ApiFacade) {}

  @Get()
  get(@Req() request: RequestWithUser): Promise<JsonBody> {
    return this.api.getUiSettings(request.user!);
  }

  @Put()
  put(
    @Req() request: RequestWithUser,
    @Body() body: JsonBody,
  ): Promise<JsonBody> {
    return this.api.putUiSettings(request.user!, body);
  }
}
