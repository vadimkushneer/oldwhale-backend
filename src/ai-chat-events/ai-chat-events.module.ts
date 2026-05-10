import { Module } from '@nestjs/common';
import { ApiModule } from '../api/api.module';
import { SecurityModule } from '../security/security.module';
import { PersistenceModule } from '../persistence/persistence.module';
import { AiChatEventsService } from './ai-chat-events.service';
import { AiChatEventsController } from './ai-chat-events.controller';

@Module({
  imports: [ApiModule, SecurityModule, PersistenceModule],
  controllers: [AiChatEventsController],
  providers: [AiChatEventsService],
})
export class AiChatEventsModule {}
