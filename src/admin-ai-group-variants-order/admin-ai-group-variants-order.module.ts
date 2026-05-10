import { Module } from '@nestjs/common';
import { ApiModule } from '../api/api.module';
import { SecurityModule } from '../security/security.module';
import { PersistenceModule } from '../persistence/persistence.module';
import { AdminAiGroupVariantsOrderService } from './admin-ai-group-variants-order.service';
import { AdminAiGroupVariantsOrderController } from './admin-ai-group-variants-order.controller';

@Module({
  imports: [ApiModule, SecurityModule, PersistenceModule],
  controllers: [AdminAiGroupVariantsOrderController],
  providers: [AdminAiGroupVariantsOrderService],
})
export class AdminAiGroupVariantsOrderModule {}
