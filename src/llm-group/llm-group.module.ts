import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LlmGroupService } from './llm-group.service';
import { LlmGroupController } from './llm-group.controller';
import { LlmGroup } from './entities/llm-group.entity';

@Module({
  imports: [TypeOrmModule.forFeature([LlmGroup])],
  controllers: [LlmGroupController],
  providers: [LlmGroupService],
})
export class LlmGroupModule {}
