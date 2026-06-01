import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { VtbClient } from './vtb.client';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, VtbClient],
  exports: [PaymentsService],
})
export class PaymentsModule {}
