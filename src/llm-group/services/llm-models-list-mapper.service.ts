import { BadRequestException, Injectable } from '@nestjs/common';

type UnknownRecord = Record<string, unknown>;

export interface NormalizedLlmModel {
  name: string;
  displayName: string | null;
}

@Injectable()
export class LlmModelsListMapperService {
  mapModelsListResponse(response: unknown): NormalizedLlmModel[] {
    if (this.isAnthropicModelsListResponse(response)) {
      return this.mapAnthropicModelsListResponse(response);
    }

    if (this.isOpenAiCompatibleModelsListResponse(response)) {
      return this.mapOpenAiCompatibleModelsListResponse(response);
    }

    throw new BadRequestException('Unsupported LLM models list response shape');
  }

  mapAnthropicModelsListResponse(response: unknown): NormalizedLlmModel[] {
    const data = this.readModelsData(response, 'Anthropic');

    return data.map((item, index) => {
      const id = this.readRequiredString(item, 'id', 'Anthropic', index);
      const displayName = this.readOptionalString(item, 'display_name');

      return {
        name: id,
        displayName: displayName ?? id,
      };
    });
  }

  mapOpenAiCompatibleModelsListResponse(response: unknown): NormalizedLlmModel[] {
    const data = this.readModelsData(response, 'OpenAI-compatible');

    return data.map((item, index) => {
      const id = this.readRequiredString(
        item,
        'id',
        'OpenAI-compatible',
        index,
      );

      return {
        name: id,
        displayName: id,
      };
    });
  }

  private isAnthropicModelsListResponse(
    response: unknown,
  ): response is UnknownRecord {
    const data = this.tryReadModelsData(response);
    return data?.some((item) => typeof item.display_name === 'string') ?? false;
  }

  private isOpenAiCompatibleModelsListResponse(
    response: unknown,
  ): response is UnknownRecord {
    if (!this.isRecord(response)) {
      return false;
    }

    const data = this.tryReadModelsData(response);
    if (!data) {
      return false;
    }

    return response.object === 'list' || data.every((item) => 'id' in item);
  }

  private readModelsData(response: unknown, provider: string): UnknownRecord[] {
    const data = this.tryReadModelsData(response);

    if (!data) {
      throw new BadRequestException(
        `${provider} models list response must include a data array`,
      );
    }

    return data;
  }

  private tryReadModelsData(response: unknown): UnknownRecord[] | null {
    if (!this.isRecord(response) || !Array.isArray(response.data)) {
      return null;
    }

    if (!response.data.every((item) => this.isRecord(item))) {
      return null;
    }

    return response.data;
  }

  private readRequiredString(
    item: UnknownRecord,
    key: string,
    provider: string,
    index: number,
  ): string {
    const value = item[key];

    if (typeof value !== 'string' || value.length === 0) {
      throw new BadRequestException(
        `${provider} model at index ${index} must include a non-empty ${key}`,
      );
    }

    return value;
  }

  private readOptionalString(
    item: UnknownRecord,
    key: string,
  ): string | undefined {
    const value = item[key];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  private isRecord(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
