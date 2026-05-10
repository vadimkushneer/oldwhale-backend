import { Module } from '@nestjs/common';
import { ApiModule } from '../api/api.module';
import { SecurityModule } from '../security/security.module';
import { PersistenceModule } from '../persistence/persistence.module';
import { AdminAiModelProvidersService } from './admin-ai-model-providers.service';
import { AdminAiModelProvidersController } from './admin-ai-model-providers.controller';

@Module({
  imports: [ApiModule, SecurityModule, PersistenceModule],
  controllers: [AdminAiModelProvidersController],
  providers: [AdminAiModelProvidersService],
})
export class AdminAiModelProvidersModule {}
