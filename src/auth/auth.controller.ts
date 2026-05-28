import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('api/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @HttpCode(200)
  register(@Body() body: { email?: string; password?: string; setupToken?: string }) {
    return this.auth.register(body);
  }

  @Post('register/request-otp')
  @HttpCode(200)
  requestRegistrationOtp(@Body() body: { email?: string }) {
    return this.auth.requestRegistrationOtp(body);
  }

  @Post('register/verify-otp')
  @HttpCode(200)
  verifyRegistrationOtp(@Body() body: { email?: string; otp?: string }) {
    return this.auth.verifyRegistrationOtp(body);
  }

  @Post('register/complete')
  @HttpCode(200)
  completeRegistration(@Body() body: { email?: string; password?: string; setupToken?: string }) {
    return this.auth.completeRegistration(body);
  }

  @Post('login')
  @HttpCode(200)
  login(@Body() body: { username?: string; login?: string; password?: string }) {
    return this.auth.login(body);
  }
}
