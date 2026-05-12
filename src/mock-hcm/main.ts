import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { MockHcmModule } from './mock-hcm.module';

async function bootstrap() {
  const app = await NestFactory.create(MockHcmModule, { logger: ['error', 'warn', 'log'] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const port = parseInt(process.env.MOCK_HCM_PORT ?? '3001', 10);
  await app.listen(port);
  console.log(`Mock HCM server running on port ${port}`);
}

bootstrap();
