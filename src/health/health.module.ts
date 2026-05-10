import { Module } from '@nestjs/common';
import { ApiModule } from '../api/api.module';
import { SecurityModule } from '../security/security.module';
import { PersistenceModule } from '../persistence/persistence.module';
import { HealthService } from './health.service';
import { HealthController } from './health.controller';

@Module({
  imports: [ApiModule, SecurityModule, PersistenceModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
