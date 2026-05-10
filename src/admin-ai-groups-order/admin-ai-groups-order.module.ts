import { Module } from '@nestjs/common';
import { ApiModule } from '../api/api.module';
import { SecurityModule } from '../security/security.module';
import { PersistenceModule } from '../persistence/persistence.module';
import { AdminAiGroupsOrderService } from './admin-ai-groups-order.service';
import { AdminAiGroupsOrderController } from './admin-ai-groups-order.controller';

@Module({
  imports: [ApiModule, SecurityModule, PersistenceModule],
  controllers: [AdminAiGroupsOrderController],
  providers: [AdminAiGroupsOrderService],
})
export class AdminAiGroupsOrderModule {}
