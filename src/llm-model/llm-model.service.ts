import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateLlmModelDto } from './dto/create-llm-model.dto';
import { UpdateLlmModelDto } from './dto/update-llm-model.dto';
import { LlmModel } from './entities/llm-model.entity';

@Injectable()
export class LlmModelService {
  constructor(
    @InjectRepository(LlmModel)
    private readonly llmModelRepository: Repository<LlmModel>,
  ) {}

  create(createLlmModelDto: CreateLlmModelDto): Promise<LlmModel> {
    return this.llmModelRepository.save(
      this.llmModelRepository.create(createLlmModelDto),
    );
  }

  findAll(): Promise<LlmModel[]> {
    return this.llmModelRepository.find({
      order: { name: 'ASC' },
    });
  }

  async findOne(uid: string): Promise<LlmModel> {
    const entity = await this.llmModelRepository.findOne({
      where: { uid },
    });

    if (!entity) {
      throw new NotFoundException(`llm-model with uid "${uid}" not found`);
    }

    return entity;
  }

  async update(
    uid: string,
    updateLlmModelDto: UpdateLlmModelDto,
  ): Promise<LlmModel> {
    const entity = await this.findOne(uid);
    Object.assign(entity, updateLlmModelDto);
    return this.llmModelRepository.save(entity);
  }

  async remove(uid: string): Promise<void> {
    const entity = await this.findOne(uid);
    await this.llmModelRepository.remove(entity);
  }
}
