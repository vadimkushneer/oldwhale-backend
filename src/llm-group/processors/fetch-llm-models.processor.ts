import { Processor, WorkerHost } from '@nestjs/bullmq';
import { BadGatewayException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { Repository } from 'typeorm';
import { LlmModel } from '../../llm-model/entities/llm-model.entity';
import { LlmGroup } from '../entities/llm-group.entity';
import { LlmModelsListMapperService } from '../services/llm-models-list-mapper.service';

export const FETCH_LLM_MODELS_QUEUE = 'fetch-llm-models';
export const FETCH_LLM_MODELS_JOB = 'fetch-llm-models-list';

export interface FetchLlmModelsJobData {
  llmGroupUid: string;
  modelsListRequestUrl: string;
  apiKey?: string;
}

@Processor(FETCH_LLM_MODELS_QUEUE)
export class FetchLlmModelsProcessor extends WorkerHost {
  constructor(
    @InjectRepository(LlmGroup)
    private readonly llmGroupRepository: Repository<LlmGroup>,
    @InjectRepository(LlmModel)
    private readonly llmModelRepository: Repository<LlmModel>,
    private readonly mapper: LlmModelsListMapperService,
  ) {
    super();
  }

  async process(job: Job<FetchLlmModelsJobData>): Promise<LlmGroup> {
    if (job.name !== FETCH_LLM_MODELS_JOB) {
      throw new BadGatewayException(`Unsupported job "${job.name}"`);
    }

    const llmGroup = await this.llmGroupRepository.findOne({
      where: { uid: job.data.llmGroupUid },
    });

    if (!llmGroup) {
      throw new NotFoundException(
        `llm-group with uid "${job.data.llmGroupUid}" not found`,
      );
    }

    const response = await this.fetchModelsList(job.data);
    const models = this.mapper.mapModelsListResponse(response);

    if (models.length > 0) {
      await this.llmModelRepository.upsert(
        models.map((model) =>
          this.llmModelRepository.create({
            ...model,
            llmGroup,
            llmGroupUid: llmGroup.uid,
          }),
        ),
        {
          conflictPaths: ['llmGroupUid', 'name'],
          skipUpdateIfNoValuesChanged: true,
        },
      );
    }

    return this.loadGroupWithModels(llmGroup.uid);
  }

  private async fetchModelsList(data: FetchLlmModelsJobData): Promise<unknown> {
    const headers: Record<string, string> = {
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    };

    if (data.apiKey) {
      headers['x-api-key'] = data.apiKey;
    }

    let response: Awaited<ReturnType<typeof fetch>>;
    try {
      response = await fetch(data.modelsListRequestUrl, { headers });
    } catch (error) {
      throw new BadGatewayException(
        `Failed to fetch LLM models list: ${this.readErrorMessage(error)}`,
      );
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new BadGatewayException(
        `Failed to fetch LLM models list: ${response.status} ${response.statusText}${body ? ` - ${body}` : ''}`,
      );
    }

    try {
      return (await response.json()) as unknown;
    } catch (error) {
      throw new BadGatewayException(
        `Failed to parse LLM models list response: ${this.readErrorMessage(error)}`,
      );
    }
  }

  private async loadGroupWithModels(uid: string): Promise<LlmGroup> {
    const llmGroup = await this.llmGroupRepository.findOne({
      where: { uid },
      relations: { llmModels: true },
      order: { llmModels: { name: 'ASC' } },
    });

    if (!llmGroup) {
      throw new NotFoundException(`llm-group with uid "${uid}" not found`);
    }

    llmGroup.readApiKeyFromEnv();
    return llmGroup;
  }

  private readErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
