import { PartialType } from '@nestjs/swagger';
import { CreateLlmGroupDto } from './create-llm-group.dto';

export class UpdateLlmGroupDto extends PartialType(CreateLlmGroupDto) {}