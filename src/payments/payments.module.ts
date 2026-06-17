import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { UsersService } from '../users/users.service';
import { MePaymentsController } from './me-payments.controller';
import { PaymentsService } from './payments.service';
import { VtbCallbackController } from './vtb-callback.controller';
import { VtbGatewayService } from './vtb-gateway.service';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [MePaymentsController, VtbCallbackController],
  providers: [PaymentsService, VtbGatewayService, UsersService],
})
export class PaymentsModule {}
