import { PartialType } from '@nestjs/swagger';
import { CreateLlmModelDto } from './create-llm-model.dto';

export class UpdateLlmModelDto extends PartialType(CreateLlmModelDto) {}
