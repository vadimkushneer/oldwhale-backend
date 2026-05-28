import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { JobsModule } from '../jobs/jobs.module';
import { AiCatalogService } from './ai-catalog.service';
import { AiChatService } from './ai-chat.service';
import { AiController } from './ai.controller';

@Module({
  imports: [AuthModule, DatabaseModule, JobsModule],
  controllers: [AiController],
  providers: [AiCatalogService, AiChatService],
  exports: [AiCatalogService],
})
export class AiModule {}
