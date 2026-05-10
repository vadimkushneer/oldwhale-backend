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

@Controller('api/admin/users')
@UseGuards(AdminGuard)
export class AdminUsersController {
  constructor(private readonly api: ApiFacade) {}

  @Get()
  findAll(): Promise<JsonBody> {
    return this.api.listUsers();
  }

  @Post()
  create(@Body() body: JsonBody): Promise<JsonBody> {
    return this.api.createUser(body);
  }

  @Patch(':uid')
  update(@Param('uid') uid: string, @Body() body: JsonBody): Promise<JsonBody> {
    return this.api.patchUser(uid, body);
  }

  @Delete(':uid')
  @HttpCode(204)
  remove(@Param('uid') uid: string): Promise<void> {
    return this.api.deleteUser(uid);
  }
}
