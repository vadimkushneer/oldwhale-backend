import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('api/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  register(@Body() body: { username?: string; login?: string; email?: string; password?: string }) {
    return this.auth.register(body);
  }

  @Post('login')
  login(@Body() body: { username?: string; login?: string; password?: string }) {
    return this.auth.login(body);
  }
}
