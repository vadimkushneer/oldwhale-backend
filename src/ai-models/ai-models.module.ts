import { Module } from '@nestjs/common';
import { ApiModule } from '../api/api.module';
import { SecurityModule } from '../security/security.module';
import { PersistenceModule } from '../persistence/persistence.module';
import { AiModelsService } from './ai-models.service';
import { AiModelsController } from './ai-models.controller';

@Module({
  imports: [ApiModule, SecurityModule, PersistenceModule],
  controllers: [AiModelsController],
  providers: [AiModelsService],
})
export class AiModelsModule {}
