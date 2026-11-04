import { HttpException } from '@nestjs/common';

export interface ErrorDetail {
  field?: string;
  message: string;
}

/** Stable API error carrying a machine-readable code (see docs/api/authentication-and-authorization.md). */
export class ApiError extends HttpException {
  constructor(
    status: number,
    public readonly code: string,
    message: string,
    public readonly details: ErrorDetail[] = [],
    public readonly headers: Record<string, string> = {},
    public readonly extra: Record<string, unknown> = {},
  ) {
    super({ code, message, details }, status);
  }
}

export const notFound = (what = 'Resource') => new ApiError(404, 'NOT_FOUND', `${what} not found`);
export const forbidden = (msg = 'You do not have permission to perform this action') => new ApiError(403, 'FORBIDDEN', msg);
export const unauthorized = (msg = 'Authentication required') => new ApiError(401, 'UNAUTHENTICATED', msg);
export const conflict = (code: string, msg: string) => new ApiError(409, code, msg);
export const unprocessable = (code: string, msg: string, details: ErrorDetail[] = []) => new ApiError(422, code, msg, details);
export const badRequest = (code: string, msg: string, details: ErrorDetail[] = []) => new ApiError(400, code, msg, details);
export const tooMany = (retryAfterSec: number) =>
  new ApiError(429, 'RATE_LIMITED', 'Too many requests. Please try again shortly.', [], { 'Retry-After': String(retryAfterSec) });
