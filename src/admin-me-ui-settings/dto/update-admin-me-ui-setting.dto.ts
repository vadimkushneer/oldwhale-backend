import { PartialType } from '@nestjs/swagger';
import { CreateAdminMeUiSettingDto } from './create-admin-me-ui-setting.dto';

export class UpdateAdminMeUiSettingDto extends PartialType(
  CreateAdminMeUiSettingDto,
) {}
