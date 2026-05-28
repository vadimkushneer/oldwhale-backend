import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AppModule } from './app.module';
import { corsOrigin, readPort } from './config/env';

function openApiPath(): string | undefined {
  return [join(process.cwd(), 'openapi.yaml'), join(process.cwd(), 'src/openapi.yaml')].find((path) => existsSync(path));
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: corsOrigin(), credentials: true });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: false }));

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Old Whale API')
    .setDescription('Lightweight NestJS backend for Old Whale')
    .setVersion('2.0.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('swagger', app, SwaggerModule.createDocument(app, swaggerConfig));

  const specPath = openApiPath();
  if (specPath) {
    app.getHttpAdapter().get('/openapi.yaml', (_request: Request, response: Response) => {
      response.type('application/yaml').send(readFileSync(specPath, 'utf8'));
    });
  }

  await app.listen(readPort(), '0.0.0.0');
}

void bootstrap();
