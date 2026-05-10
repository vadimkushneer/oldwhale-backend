import { Module } from '@nestjs/common';
import { ApiModule } from '../api/api.module';
import { SecurityModule } from '../security/security.module';
import { PersistenceModule } from '../persistence/persistence.module';
import { AdminAiGroupsService } from './admin-ai-groups.service';
import { AdminAiGroupsController } from './admin-ai-groups.controller';

@Module({
  imports: [ApiModule, SecurityModule, PersistenceModule],
  controllers: [AdminAiGroupsController],
  providers: [AdminAiGroupsService],
})
export class AdminAiGroupsModule {}
