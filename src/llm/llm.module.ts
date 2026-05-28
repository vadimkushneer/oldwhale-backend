import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { JobsModule } from '../jobs/jobs.module';
import { LlmController } from './llm.controller';
import { LlmService } from './llm.service';

@Module({
  imports: [DatabaseModule, JobsModule],
  controllers: [LlmController],
  providers: [LlmService],
})
export class LlmModule {}
