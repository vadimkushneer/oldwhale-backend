import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AdminGuard, JwtAuthGuard } from '../auth/auth.guard';
import { UsersService } from '../users/users.service';

@Controller('api/admin/users')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminUsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list() {
    return { users: this.users.list() };
  }

  @Post()
  @HttpCode(200)
  create(@Body() body: { username?: string; login?: string; email: string; password: string; role?: 'user' | 'admin' }) {
    return { user: this.users.create(body) };
  }

  @Patch(':idOrUid')
  patch(@Param('idOrUid') idOrUid: string, @Body() body: { disabled?: boolean; role?: 'user' | 'admin' }) {
    return { user: this.users.patch(idOrUid, body) };
  }

  @Delete(':idOrUid')
  @HttpCode(204)
  remove(@Param('idOrUid') idOrUid: string) {
    this.users.delete(idOrUid);
  }
}
