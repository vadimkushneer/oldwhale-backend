import { Module } from '@nestjs/common';
import { ApiModule } from '../api/api.module';
import { SecurityModule } from '../security/security.module';
import { PersistenceModule } from '../persistence/persistence.module';
import { AdminAiVariantsService } from './admin-ai-variants.service';
import { AdminAiVariantsController } from './admin-ai-variants.controller';

@Module({
  imports: [ApiModule, SecurityModule, PersistenceModule],
  controllers: [AdminAiVariantsController],
  providers: [AdminAiVariantsService],
})
export class AdminAiVariantsModule {}
