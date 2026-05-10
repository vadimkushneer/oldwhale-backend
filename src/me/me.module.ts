import { Module } from '@nestjs/common';
import { ApiModule } from '../api/api.module';
import { SecurityModule } from '../security/security.module';
import { PersistenceModule } from '../persistence/persistence.module';
import { MeService } from './me.service';
import { MeController } from './me.controller';

@Module({
  imports: [ApiModule, SecurityModule, PersistenceModule],
  controllers: [MeController],
  providers: [MeService],
})
export class MeModule {}
