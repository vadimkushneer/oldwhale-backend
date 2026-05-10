import { PartialType } from '@nestjs/swagger';
import { CreateAiChatEventDto } from './create-ai-chat-event.dto';

export class UpdateAiChatEventDto extends PartialType(CreateAiChatEventDto) {}
