import { Module } from '@nestjs/common';
import { ApiModule } from '../api/api.module';
import { SecurityModule } from '../security/security.module';
import { PersistenceModule } from '../persistence/persistence.module';
import { AdminAiEnvCheckService } from './admin-ai-env-check.service';
import { AdminAiEnvCheckController } from './admin-ai-env-check.controller';

@Module({
  imports: [ApiModule, SecurityModule, PersistenceModule],
  controllers: [AdminAiEnvCheckController],
  providers: [AdminAiEnvCheckService],
})
export class AdminAiEnvCheckModule {}
