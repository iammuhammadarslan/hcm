import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { AppException } from '../exceptions/app.exception';

@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(AppExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception instanceof AppException) {
      return response.status(exception.statusCode).json({
        statusCode: exception.statusCode,
        error: exception.error,
        message: exception.message,
        ...(exception.details ? { details: exception.details } : {}),
      });
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      // NestJS ValidationPipe throws HttpException with 400
      if (status === 400 && typeof body === 'object' && (body as any).message) {
        const messages = (body as any).message;
        const fields = Array.isArray(messages)
          ? messages.map((m: string) => ({ field: m.split(' ')[0], issue: m, expectedType: 'unknown' }))
          : [{ field: 'unknown', issue: String(messages), expectedType: 'unknown' }];
        return response.status(400).json({
          statusCode: 400,
          error: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: { fields },
        });
      }
      return response.status(status).json(body);
    }

    this.logger.error('Unhandled exception', exception instanceof Error ? exception.stack : String(exception));
    return response.status(500).json({
      statusCode: 500,
      error: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred',
    });
  }
}
