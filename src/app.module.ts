import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { databaseEntities } from './database/entities';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { MeModule } from './me/me.module';
import { AiModelsModule } from './ai-models/ai-models.module';
import { AiChatModule } from './ai-chat/ai-chat.module';
import { AiChatEventsModule } from './ai-chat-events/ai-chat-events.module';
import { AdminAiChatLogsModule } from './admin-ai-chat-logs/admin-ai-chat-logs.module';
import { AdminMeUiSettingsModule } from './admin-me-ui-settings/admin-me-ui-settings.module';
import { AdminAiEnvCheckModule } from './admin-ai-env-check/admin-ai-env-check.module';
import { AdminAiModelProvidersModule } from './admin-ai-model-providers/admin-ai-model-providers.module';
import { AdminAiGroupsModule } from './admin-ai-groups/admin-ai-groups.module';
import { AdminAiGroupsOrderModule } from './admin-ai-groups-order/admin-ai-groups-order.module';
import { AdminAiGroupModelsImportModule } from './admin-ai-group-models-import/admin-ai-group-models-import.module';
import { AdminAiGroupVariantsModule } from './admin-ai-group-variants/admin-ai-group-variants.module';
import { AdminAiGroupVariantsOrderModule } from './admin-ai-group-variants-order/admin-ai-group-variants-order.module';
import { AdminAiVariantsModule } from './admin-ai-variants/admin-ai-variants.module';
import { AdminUsersModule } from './admin-users/admin-users.module';
import { LlmGroupModule } from './llm-group/llm-group.module';
import { LlmModelModule } from './llm-model/llm-model.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../.env', '.env'] }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const databaseUrl = configService.get<string>('DATABASE_URL');
        if (!databaseUrl) {
          throw new Error('DATABASE_URL is required');
        }
        return {
          type: 'postgres' as const,
          url: databaseUrl,
          entities: databaseEntities,
          synchronize: configService.get<string>('DB_SYNCHRONIZE') !== 'false',
          ssl: databaseUrl.includes('sslmode=require')
            ? { rejectUnauthorized: false }
            : false,
        };
      },
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get<string>('REDIS_HOST') ?? 'localhost',
          port: Number(configService.get<string>('REDIS_PORT') ?? 6379),
          password: configService.get<string>('REDIS_PASSWORD') || undefined,
        },
      }),
    }),
    HealthModule,
    AuthModule,
    MeModule,
    AiModelsModule,
    AiChatModule,
    AiChatEventsModule,
    AdminAiChatLogsModule,
    AdminMeUiSettingsModule,
    AdminAiEnvCheckModule,
    AdminAiModelProvidersModule,
    AdminAiGroupsModule,
    AdminAiGroupsOrderModule,
    AdminAiGroupModelsImportModule,
    AdminAiGroupVariantsModule,
    AdminAiGroupVariantsOrderModule,
    AdminAiVariantsModule,
    AdminUsersModule,
    LlmGroupModule,
    LlmModelModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
