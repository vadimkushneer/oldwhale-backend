import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ApiFacade } from '../api/api.facade';
import type { JsonBody } from '../api/api.facade';
import { JwtAuthGuard } from '../security/jwt-auth.guard';
import type { RequestWithUser } from '../security/request-with-user';

@Controller('api/me')
@UseGuards(JwtAuthGuard)
export class MeController {
  constructor(private readonly api: ApiFacade) {}

  @Get()
  getMe(@Req() request: RequestWithUser): JsonBody {
    return this.api.getMe(request.user!);
  }
}
