import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get()
  root() {
    return { name: 'oldwhale-backend', status: 'ok' };
  }
}
