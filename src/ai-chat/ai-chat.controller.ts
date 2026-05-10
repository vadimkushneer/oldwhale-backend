import { Body, Controller, Post, Req } from '@nestjs/common';
import { ApiFacade } from '../api/api.facade';
import type { JsonBody } from '../api/api.facade';
import type { RequestWithUser } from '../security/request-with-user';

@Controller('api/ai/chat')
export class AiChatController {
  constructor(private readonly api: ApiFacade) {}

  @Post()
  create(
    @Body() body: JsonBody,
    @Req() request: RequestWithUser,
  ): Promise<JsonBody> {
    return this.api.acceptChat(body, {
      user: request.user,
      ip: request.ip,
      userAgent:
        typeof request.headers['user-agent'] === 'string'
          ? request.headers['user-agent']
          : null,
    });
  }
}
