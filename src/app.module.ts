import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AdminModule } from './admin/admin.module';
import { AiModule } from './ai/ai.module';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { InitialAdminService } from './bootstrap/initial-admin.service';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { JobsModule } from './jobs/jobs.module';
import { LlmModule } from './llm/llm.module';
import { PaymentsModule } from './payments/payments.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../.env', '.env'] }),
    DatabaseModule,
    JobsModule,
    AuthModule,
    AdminModule,
    AiModule,
    LlmModule,
    PaymentsModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [InitialAdminService],
})
export class AppModule {}
