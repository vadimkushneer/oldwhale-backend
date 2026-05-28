import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentUser } from './current-user.decorator';
import { JwtAuthGuard } from './auth.guard';
import type { PublicUser } from '../users/users.types';

@Controller('api/me')
export class MeController {
  @Get()
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: PublicUser) {
    return user;
  }
}
