import { Module } from '@nestjs/common';
import { ApiModule } from '../api/api.module';
import { SecurityModule } from '../security/security.module';
import { PersistenceModule } from '../persistence/persistence.module';
import { AdminAiGroupModelsImportService } from './admin-ai-group-models-import.service';
import { AdminAiGroupModelsImportController } from './admin-ai-group-models-import.controller';

@Module({
  imports: [ApiModule, SecurityModule, PersistenceModule],
  controllers: [AdminAiGroupModelsImportController],
  providers: [AdminAiGroupModelsImportService],
})
export class AdminAiGroupModelsImportModule {}
