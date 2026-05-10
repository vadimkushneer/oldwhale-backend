import { PartialType } from '@nestjs/swagger';
import { CreateAdminAiGroupsOrderDto } from './create-admin-ai-groups-order.dto';

export class UpdateAdminAiGroupsOrderDto extends PartialType(
  CreateAdminAiGroupsOrderDto,
) {}
