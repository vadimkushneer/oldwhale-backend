import { Module } from '@nestjs/common';
import { ApiModule } from '../api/api.module';
import { SecurityModule } from '../security/security.module';
import { PersistenceModule } from '../persistence/persistence.module';
import { AiChatService } from './ai-chat.service';
import { AiChatController } from './ai-chat.controller';

@Module({
  imports: [ApiModule, SecurityModule, PersistenceModule],
  controllers: [AiChatController],
  providers: [AiChatService],
})
export class AiChatModule {}
