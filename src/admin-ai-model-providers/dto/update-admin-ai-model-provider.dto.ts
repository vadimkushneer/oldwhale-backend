import { PartialType } from '@nestjs/swagger';
import { CreateAdminAiModelProviderDto } from './create-admin-ai-model-provider.dto';

export class UpdateAdminAiModelProviderDto extends PartialType(
  CreateAdminAiModelProviderDto,
) {}
