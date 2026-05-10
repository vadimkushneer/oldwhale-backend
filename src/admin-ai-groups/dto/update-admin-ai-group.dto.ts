import { PartialType } from '@nestjs/swagger';
import { CreateAdminAiGroupDto } from './create-admin-ai-group.dto';

export class UpdateAdminAiGroupDto extends PartialType(CreateAdminAiGroupDto) {}
