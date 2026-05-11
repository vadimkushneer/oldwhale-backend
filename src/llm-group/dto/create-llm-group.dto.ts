import { IsNotEmpty, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class CreateLlmGroupDto {
  @IsOptional()
  @IsString()
  uid?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  apiKeyEnvVar: string;

  // Runtime-only convenience input; not persisted.
  // If sent, it can be used to override env reading for the current instance in memory.
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  apiKey?: string;

  @IsString()
  @IsNotEmpty()
  @IsUrl({
    require_tld: false,
    require_protocol: true,
  })
  modelsListRequestUrl: string;
}
