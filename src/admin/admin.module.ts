import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { AdminUsersController } from './admin-users.controller';
import { AdminEmailDeliveryLogsController } from './admin-email-delivery-logs.controller';
import { AdminUiSettingsController } from './admin-ui-settings.controller';
import { AdminUiSettingsService } from './admin-ui-settings.service';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [
    AdminUsersController,
    AdminEmailDeliveryLogsController,
    AdminUiSettingsController,
  ],
  providers: [AdminUiSettingsService],
})
export class AdminModule {}
