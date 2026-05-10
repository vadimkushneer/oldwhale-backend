import { Controller, Get, Header, Query } from '@nestjs/common';

@Controller('api/ai/chat/events')
export class AiChatEventsController {
  @Get()
  @Header('Content-Type', 'text/event-stream')
  events(@Query('request_uid') requestUid: string): string {
    return `event: ready\ndata: ${JSON.stringify({ request_uid: requestUid })}\n\n`;
  }
}
