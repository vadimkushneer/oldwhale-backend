import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { UsersService } from '../users/users.service';
import { JwtService } from '../security/jwt.service';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { MeController } from './me.controller';
import { AdminGuard, JwtAuthGuard, OptionalJwtAuthGuard } from './auth.guard';
import { EmailDeliveryLogService } from './email-delivery-log.service';
import { MailService } from './mail.service';
import { RegistrationOtpService } from './registration-otp.service';

@Module({
  imports: [DatabaseModule],
  controllers: [AuthController, MeController],
  providers: [
    UsersService,
    JwtService,
    EmailDeliveryLogService,
    MailService,
    RegistrationOtpService,
    AuthService,
    JwtAuthGuard,
    OptionalJwtAuthGuard,
    AdminGuard,
  ],
  exports: [
    UsersService,
    JwtService,
    AuthService,
    EmailDeliveryLogService,
    JwtAuthGuard,
    OptionalJwtAuthGuard,
    AdminGuard,
  ],
})
export class AuthModule {}
