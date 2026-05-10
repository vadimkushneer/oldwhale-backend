import { PartialType } from '@nestjs/swagger';
import { CreateAdminAiGroupModelsImportDto } from './create-admin-ai-group-models-import.dto';

export class UpdateAdminAiGroupModelsImportDto extends PartialType(
  CreateAdminAiGroupModelsImportDto,
) {}
