import { Controller, Get } from '@nestjs/common';
import { ApiFacade } from '../api/api.facade';

@Controller('health')
export class HealthController {
  constructor(private readonly api: ApiFacade) {}

  @Get()
  getHealth(): { status: string } {
    return this.api.getHealth();
  }
}
