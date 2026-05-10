import { PartialType } from '@nestjs/swagger';
import { CreateAiModelDto } from './create-ai-model.dto';

export class UpdateAiModelDto extends PartialType(CreateAiModelDto) {}
