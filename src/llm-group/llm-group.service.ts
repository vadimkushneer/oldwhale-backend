import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { CreateLlmGroupDto } from './dto/create-llm-group.dto';
import { UpdateLlmGroupDto } from './dto/update-llm-group.dto';
import { LlmGroup } from './entities/llm-group.entity';
import {
  FETCH_LLM_MODELS_JOB,
  FETCH_LLM_MODELS_QUEUE,
  FetchLlmModelsJobData,
} from './processors/fetch-llm-models.processor';

export interface FetchLlmModelsListQueueResult {
  jobId: string | null;
  jobName: typeof FETCH_LLM_MODELS_JOB;
  llmGroupUid: string;
  queueName: typeof FETCH_LLM_MODELS_QUEUE;
}

@Injectable()
export class LlmGroupService {
  constructor(
    @InjectRepository(LlmGroup)
    private readonly llmGroupRepository: Repository<LlmGroup>,
    @InjectQueue(FETCH_LLM_MODELS_QUEUE)
    private readonly fetchLlmModelsQueue: Queue<FetchLlmModelsJobData>,
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
      relations: { llmModels: true },
      order: { uid: 'ASC', llmModels: { name: 'ASC' } },
    });
  }

  async findOne(uid: string): Promise<LlmGroup> {
    const entity = await this.llmGroupRepository.findOne({
      where: { uid },
      relations: { llmModels: true },
      order: { llmModels: { name: 'ASC' } },
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

  async fetchLlmModelsList(
    uid: string,
  ): Promise<FetchLlmModelsListQueueResult> {
    const entity = await this.findOne(uid);
    const apiKey = entity.apiKey ?? entity.readApiKeyFromEnv();
    const job = await this.fetchLlmModelsQueue.add(
      FETCH_LLM_MODELS_JOB,
      {
        llmGroupUid: entity.uid,
        modelsListRequestUrl: entity.modelsListRequestUrl,
        apiKey,
      },
      {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
        removeOnComplete: {
          age: 24 * 60 * 60,
          count: 1000,
        },
        removeOnFail: {
          age: 7 * 24 * 60 * 60,
        },
      },
    );

    return {
      jobId: job.id ?? null,
      jobName: FETCH_LLM_MODELS_JOB,
      llmGroupUid: entity.uid,
      queueName: FETCH_LLM_MODELS_QUEUE,
    };
  }
}