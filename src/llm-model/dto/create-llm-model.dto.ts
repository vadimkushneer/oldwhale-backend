import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateLlmModelDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  displayName?: string | null;

  @IsUUID()
  llmGroupUid: string;
}
