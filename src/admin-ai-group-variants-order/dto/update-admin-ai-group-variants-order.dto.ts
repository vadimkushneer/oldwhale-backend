import { PartialType } from '@nestjs/swagger';
import { CreateAdminAiGroupVariantsOrderDto } from './create-admin-ai-group-variants-order.dto';

export class UpdateAdminAiGroupVariantsOrderDto extends PartialType(
  CreateAdminAiGroupVariantsOrderDto,
) {}
