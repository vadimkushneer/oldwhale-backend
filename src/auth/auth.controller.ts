import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('api/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @HttpCode(200)
  register(@Body() body: { username?: string; login?: string; email?: string; password?: string }) {
    return this.auth.register(body);
  }

  @Post('login')
  @HttpCode(200)
  login(@Body() body: { username?: string; login?: string; password?: string }) {
    return this.auth.login(body);
  }
}
