import { Module } from '@nestjs/common';
import { ApiModule } from '../api/api.module';
import { SecurityModule } from '../security/security.module';
import { PersistenceModule } from '../persistence/persistence.module';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';

@Module({
  imports: [ApiModule, SecurityModule, PersistenceModule],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
