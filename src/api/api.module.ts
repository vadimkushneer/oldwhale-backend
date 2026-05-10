import { Module } from '@nestjs/common';
import { PersistenceModule } from '../persistence/persistence.module';
import { SecurityModule } from '../security/security.module';
import { ApiFacade } from './api.facade';

@Module({
  imports: [PersistenceModule, SecurityModule],
  providers: [ApiFacade],
  exports: [ApiFacade],
})
export class ApiModule {}
