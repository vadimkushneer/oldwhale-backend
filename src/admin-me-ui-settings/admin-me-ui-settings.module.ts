import { Module } from '@nestjs/common';
import { ApiModule } from '../api/api.module';
import { SecurityModule } from '../security/security.module';
import { PersistenceModule } from '../persistence/persistence.module';
import { AdminMeUiSettingsService } from './admin-me-ui-settings.service';
import { AdminMeUiSettingsController } from './admin-me-ui-settings.controller';

@Module({
  imports: [ApiModule, SecurityModule, PersistenceModule],
  controllers: [AdminMeUiSettingsController],
  providers: [AdminMeUiSettingsService],
})
export class AdminMeUiSettingsModule {}
