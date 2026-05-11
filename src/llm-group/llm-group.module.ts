import { Module } from '@nestjs/common';
import { LlmGroupService } from './llm-group.service';
import { LlmGroupController } from './llm-group.controller';

@Module({
  controllers: [LlmGroupController],
  providers: [LlmGroupService],
})
export class LlmGroupModule {}
