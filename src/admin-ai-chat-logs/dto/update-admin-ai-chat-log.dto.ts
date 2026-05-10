import { PartialType } from '@nestjs/swagger';
import { CreateAdminAiChatLogDto } from './create-admin-ai-chat-log.dto';

export class UpdateAdminAiChatLogDto extends PartialType(
  CreateAdminAiChatLogDto,
) {}
