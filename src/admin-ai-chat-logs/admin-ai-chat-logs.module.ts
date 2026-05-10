import { Module } from '@nestjs/common';
import { ApiModule } from '../api/api.module';
import { SecurityModule } from '../security/security.module';
import { PersistenceModule } from '../persistence/persistence.module';
import { AdminAiChatLogsService } from './admin-ai-chat-logs.service';
import { AdminAiChatLogsController } from './admin-ai-chat-logs.controller';

@Module({
  imports: [ApiModule, SecurityModule, PersistenceModule],
  controllers: [AdminAiChatLogsController],
  providers: [AdminAiChatLogsService],
})
export class AdminAiChatLogsModule {}
