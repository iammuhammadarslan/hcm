import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AppExceptionFilter } from './common/filters/app-exception.filter';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      stopAtFirstError: false,
    }),
  );

  app.useGlobalFilters(new AppExceptionFilter());

  // ── Swagger ──────────────────────────────────────────────────────────────
  const config = new DocumentBuilder()
    .setTitle('Time-Off Microservice')
    .setDescription(
      'Manages employee time-off request lifecycle and keeps balances in sync with the HCM ' +
      'system (Workday / SAP). Balances are scoped per employee per location.',
    )
    .setVersion('1.0')
    .addTag('time-off-requests', 'Submit, approve, reject and cancel time-off requests')
    .addTag('balances', 'Read balances, trigger real-time HCM sync, and query discrepancy events')
    .addTag('hcm-sync', 'Receive batch balance updates pushed by the HCM system')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  logger.log(`Time-Off Microservice running on port ${port}`);
  logger.log(`Swagger UI available at http://localhost:${port}/api`);
}

bootstrap();
