import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LlmGroupService } from './llm-group.service';
import { LlmGroupController } from './llm-group.controller';
import { LlmGroup } from './entities/llm-group.entity';
import { LlmModel } from '../llm-model/entities/llm-model.entity';
import {
  FETCH_LLM_MODELS_QUEUE,
  FetchLlmModelsProcessor,
} from './processors/fetch-llm-models.processor';
import { LlmModelsListMapperService } from './services/llm-models-list-mapper.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([LlmGroup, LlmModel]),
    BullModule.registerQueue({
      name: FETCH_LLM_MODELS_QUEUE,
    }),
  ],
  controllers: [LlmGroupController],
  providers: [
    LlmGroupService,
    FetchLlmModelsProcessor,
    LlmModelsListMapperService,
  ],
})
export class LlmGroupModule {}
