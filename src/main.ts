import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { AppModule } from './app.module';

function corsOrigin(): boolean | string[] {
  const origin = process.env.CORS_ORIGIN;
  if (!origin) {
    return true;
  }
  return origin
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function openApiPath(): string | undefined {
  return [
    join(process.cwd(), 'openapi.yaml'),
    join(process.cwd(), 'src/openapi.yaml'),
  ].find((path) => existsSync(path));
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: corsOrigin(), credentials: true });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: false }));

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Old Whale API')
    .setDescription('NestJS backend for Old Whale')
    .setVersion('2.0.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup(
    'swagger',
    app,
    SwaggerModule.createDocument(app, swaggerConfig),
  );

  const specPath = openApiPath();
  if (specPath) {
    app
      .getHttpAdapter()
      .get('/openapi.yaml', (_request: Request, response: Response) => {
        response.type('application/yaml').send(readFileSync(specPath, 'utf8'));
      });
  }

  await app.listen(Number(process.env.PORT ?? 8080), '0.0.0.0');
}

void bootstrap();
