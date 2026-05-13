import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LlmModel } from './entities/llm-model.entity';
import { LlmModelController } from './llm-model.controller';
import { LlmModelService } from './llm-model.service';

@Module({
  imports: [TypeOrmModule.forFeature([LlmModel])],
  controllers: [LlmModelController],
  providers: [LlmModelService],
})
export class LlmModelModule {}
