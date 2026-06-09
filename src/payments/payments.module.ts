import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { AdminPaymentsController, MePaymentsController, PaymentsCallbackController } from './payments.controller';
import { PaymentEventsService } from './payment-events.service';
import { PaymentsService } from './payments.service';
import { VtbGatewayService } from './vtb-gateway.service';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [MePaymentsController, PaymentsCallbackController, AdminPaymentsController],
  providers: [PaymentsService, VtbGatewayService, PaymentEventsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
