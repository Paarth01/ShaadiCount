import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Inject, Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { NextFunction, Response } from 'express';
import { ApiError } from './errors';
import { AppLogger } from './logger';
import type { AppRequest } from './request';

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  constructor(@Inject('LOGGER') private readonly logger: AppLogger) {}
  use(req: AppRequest, res: Response, next: NextFunction) {
    const incoming = req.header('x-request-id');
    const requestId = incoming && /^[A-Za-z0-9_-]{8,64}$/.test(incoming) ? incoming : randomUUID();
    req.ctx = { requestId, ip: req.ip ?? 'unknown' };
    res.setHeader('X-Request-Id', requestId);
    const start = Date.now();
    res.on('finish', () => {
      // Path is redacted by the logger (RSVP tokens); query strings are dropped entirely.
      this.logger.info('request', {
        requestId,
        method: req.method,
        path: req.originalUrl.split('?')[0],
        status: res.statusCode,
        ms: Date.now() - start,
      });
    });
    next();
  }
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(@Inject('LOGGER') private readonly logger: AppLogger) {}
  catch(err: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const req = http.getRequest<AppRequest>();
    const requestId = req.ctx?.requestId ?? 'unknown';
    let status = 500;
    let code = 'INTERNAL_ERROR';
    let message = 'Something went wrong. Please try again.';
    let details: unknown[] = [];
    let extra: Record<string, unknown> = {};

    if (err instanceof ApiError) {
      status = err.getStatus();
      code = err.code;
      message = err.message;
      details = err.details;
      extra = err.extra;
      for (const [k, v] of Object.entries(err.headers)) res.setHeader(k, v);
    } else if (err instanceof HttpException) {
      status = err.getStatus();
      code = status === 404 ? 'NOT_FOUND' : status === 413 ? 'PAYLOAD_TOO_LARGE' : status === 400 ? 'BAD_REQUEST' : 'HTTP_ERROR';
      message =
        status === 404
          ? 'Resource not found'
          : status === 413
            ? 'Request body too large'
            : status === 400
              ? 'Malformed request'
              : 'Request failed';
    } else if ((err as any)?.type === 'entity.too.large') {
      status = 413;
      code = 'PAYLOAD_TOO_LARGE';
      message = 'Request body too large';
    } else if ((err as any)?.type === 'entity.parse.failed') {
      status = 400;
      code = 'BAD_REQUEST';
      message = 'Malformed JSON body';
    }

    if (status >= 500) {
      // Never log the raw error object (may embed SQL parameters / personal data); log class + redacted message only.
      this.logger.error('unhandled_error', {
        requestId,
        errorName: (err as Error)?.name,
        errorMessage: String((err as Error)?.message ?? '').slice(0, 300),
        pgCode: (err as any)?.code,
      });
    }
    res.status(status).json({ error: { code, message, requestId, details, ...extra } });
  }
}
