import { PartialType } from '@nestjs/swagger';
import { CreateAdminAiEnvCheckDto } from './create-admin-ai-env-check.dto';

export class UpdateAdminAiEnvCheckDto extends PartialType(
  CreateAdminAiEnvCheckDto,
) {}
