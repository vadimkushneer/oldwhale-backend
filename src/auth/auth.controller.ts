import { Body, Controller, Post } from '@nestjs/common';
import { ApiFacade } from '../api/api.facade';
import type { JsonBody } from '../api/api.facade';

@Controller('api/auth')
export class AuthController {
  constructor(private readonly api: ApiFacade) {}

  @Post('register')
  register(@Body() body: JsonBody): Promise<JsonBody> {
    return this.api.register(body);
  }

  @Post('login')
  login(@Body() body: JsonBody): Promise<JsonBody> {
    return this.api.login(body);
  }
}
