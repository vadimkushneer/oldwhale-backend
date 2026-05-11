import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateLlmGroupDto } from './dto/create-llm-group.dto';
import { UpdateLlmGroupDto } from './dto/update-llm-group.dto';
import { LlmGroup } from './entities/llm-group.entity';

@Injectable()
export class LlmGroupService {
  constructor(
    @InjectRepository(LlmGroup)
    private readonly llmGroupRepository: Repository<LlmGroup>,
  ) {}

  async create(createLlmGroupDto: CreateLlmGroupDto): Promise<LlmGroup> {
    const entity = new LlmGroup({
      uid: createLlmGroupDto.uid,
      apiKeyEnvVar: createLlmGroupDto.apiKeyEnvVar,
      modelsListRequestUrl: createLlmGroupDto.modelsListRequestUrl,
    });

    if (createLlmGroupDto.apiKey) {
      entity.apiKey = createLlmGroupDto.apiKey;
    } else {
      entity.readApiKeyFromEnv();
    }

    const saved = await this.llmGroupRepository.save(entity);
    saved.readApiKeyFromEnv();
    return saved;
  }

  async findAll(): Promise<LlmGroup[]> {
    return this.llmGroupRepository.find({
      order: { uid: 'ASC' },
    });
  }

  async findOne(uid: string): Promise<LlmGroup> {
    const entity = await this.llmGroupRepository.findOne({
      where: { uid },
    });

    if (!entity) {
      throw new NotFoundException(`llm-group with uid "${uid}" not found`);
    }

    entity.readApiKeyFromEnv();
    return entity;
  }

  async update(
    uid: string,
    updateLlmGroupDto: UpdateLlmGroupDto,
  ): Promise<LlmGroup> {
    const entity = await this.findOne(uid);

    if (updateLlmGroupDto.apiKeyEnvVar !== undefined) {
      entity.apiKeyEnvVar = updateLlmGroupDto.apiKeyEnvVar;
    }

    if (updateLlmGroupDto.modelsListRequestUrl !== undefined) {
      entity.modelsListRequestUrl = updateLlmGroupDto.modelsListRequestUrl;
    }

    if (updateLlmGroupDto.apiKey !== undefined) {
      entity.apiKey = updateLlmGroupDto.apiKey;
    } else {
      entity.readApiKeyFromEnv();
    }

    const saved = await this.llmGroupRepository.save(entity);
    saved.readApiKeyFromEnv();
    return saved;
  }

  async remove(uid: string): Promise<void> {
    const entity = await this.findOne(uid);
    await this.llmGroupRepository.remove(entity);
  }

  async refreshRuntimeApiKey(uid: string): Promise<LlmGroup> {
    const entity = await this.findOne(uid);
    entity.readApiKeyFromEnv();
    return entity;
  }
}