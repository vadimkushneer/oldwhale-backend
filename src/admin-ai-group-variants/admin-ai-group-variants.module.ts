import { Module } from '@nestjs/common';
import { ApiModule } from '../api/api.module';
import { SecurityModule } from '../security/security.module';
import { PersistenceModule } from '../persistence/persistence.module';
import { AdminAiGroupVariantsService } from './admin-ai-group-variants.service';
import { AdminAiGroupVariantsController } from './admin-ai-group-variants.controller';

@Module({
  imports: [ApiModule, SecurityModule, PersistenceModule],
  controllers: [AdminAiGroupVariantsController],
  providers: [AdminAiGroupVariantsService],
})
export class AdminAiGroupVariantsModule {}
