import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiFacade } from '../api/api.facade';
import type { JsonBody } from '../api/api.facade';
import { AdminGuard } from '../security/admin.guard';

@Controller('api/admin/ai/groups')
@UseGuards(AdminGuard)
export class AdminAiGroupsController {
  constructor(private readonly api: ApiFacade) {}

  @Get()
  findAll(): Promise<JsonBody> {
    return this.api.listAdminGroups();
  }

  @Post()
  create(@Body() body: JsonBody): Promise<JsonBody> {
    return this.api.createGroup(body);
  }

  @Patch(':uid')
  update(@Param('uid') uid: string, @Body() body: JsonBody): Promise<JsonBody> {
    return this.api.patchGroup(uid, body);
  }

  @Delete(':uid')
  @HttpCode(204)
  remove(@Param('uid') uid: string): Promise<void> {
    return this.api.deleteGroup(uid);
  }
}
