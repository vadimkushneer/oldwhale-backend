import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { AdminGuard, JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { PublicUser } from '../users/users.types';
import { AdminUiSettingsService } from './admin-ui-settings.service';

@Controller('api/admin/me/ui-settings')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminUiSettingsController {
  constructor(private readonly settings: AdminUiSettingsService) {}

  @Get()
  get(@CurrentUser() user: PublicUser) {
    return this.settings.get(user.uid);
  }

  @Put()
  put(@CurrentUser() user: PublicUser, @Body() body: { aiChatLogTable?: { columns?: Record<string, boolean> } }) {
    return this.settings.put(user.uid, body);
  }
}
