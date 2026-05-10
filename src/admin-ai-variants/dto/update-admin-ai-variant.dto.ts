import { PartialType } from '@nestjs/swagger';
import { CreateAdminAiVariantDto } from './create-admin-ai-variant.dto';

export class UpdateAdminAiVariantDto extends PartialType(
  CreateAdminAiVariantDto,
) {}
