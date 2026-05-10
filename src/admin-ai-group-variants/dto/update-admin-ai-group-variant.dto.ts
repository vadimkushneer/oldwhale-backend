import { PartialType } from '@nestjs/swagger';
import { CreateAdminAiGroupVariantDto } from './create-admin-ai-group-variant.dto';

export class UpdateAdminAiGroupVariantDto extends PartialType(
  CreateAdminAiGroupVariantDto,
) {}
