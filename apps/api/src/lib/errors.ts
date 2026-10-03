import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AiClientError, AiValidationError } from '../services/ai/types.js';

/** Machine-readable error codes returned in the `error.code` field. */
export type ErrorCode =
  | 'bad_request'
  | 'validation_failed'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'rate_limited'
  | 'service_unavailable'
  /** The caller asked to retry a stage that is not retryable on its own. */
  | 'stage_not_retryable'
  /** The live coach could not reach its model; the fallback path applies. */
  | 'live_unavailable'
  | 'internal_error'
  | 'cors_origin_not_allowed'
  | 'config_error';

export interface AppErrorOptions {
  details?: unknown;
  cause?: unknown;
}

/** Base class for every error we raise ourselves. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(statusCode: number, code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.statusCode = statusCode;
    this.details = options.details;
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details === undefined ? {} : { details: this.details }),
      },
    };
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad request', options?: AppErrorOptions) {
    super(400, 'bad_request', message, options);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Request validation failed', options?: AppErrorOptions) {
    super(422, 'validation_failed', message, options);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Missing or invalid credentials', options?: AppErrorOptions) {
    super(401, 'unauthorized', message, options);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Not allowed', options?: AppErrorOptions) {
    super(403, 'forbidden', message, options);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found', options?: AppErrorOptions) {
    super(404, 'not_found', message, options);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict', options?: AppErrorOptions) {
    super(409, 'conflict', message, options);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = 'Too many requests', options?: AppErrorOptions) {
    super(429, 'rate_limited', message, options);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(code: ErrorCode = 'service_unavailable', message = 'Service unavailable', options?: AppErrorOptions) {
    super(503, code, message, options);
  }
}

export class InternalError extends AppError {
  constructor(message = 'Unexpected error', options?: AppErrorOptions) {
    super(500, 'internal_error', message, options);
  }
}

interface RequestLike {
  method: string;
  originalUrl: string;
  ip?: string;
  id?: unknown;
  log?: {
    error: (obj: unknown, msg?: string) => void;
    warn: (obj: unknown, msg?: string) => void;
  };
}

/** Body-parser JSON syntax errors arrive as a plain `SyntaxError`. */
function isBodyParserError(error: unknown): error is SyntaxError & { status?: number; type?: string } {
  return error instanceof SyntaxError && 'body' in (error as object);
}

function isEntityTooLarge(error: unknown): error is Error & { status?: number; type?: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'type' in error &&
    (error as { type?: string }).type === 'entity.too.large'
  );
}

/**
 * Centralized error middleware (engineering rule 3).
 * Every failure leaves the API in the same shape: `{ error: { code, message, details?, requestId? } }`.
 */
export function errorHandler(
  error: unknown,
  req: RequestLike,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(error);
    return;
  }

  const requestId = typeof req.id === 'string' ? req.id : undefined;
  const context = {
    err: error,
    requestId,
    method: req.method,
    url: req.originalUrl,
  };

  if (error instanceof ZodError) {
    req.log?.warn({ ...context, issues: error.issues }, 'request validation failed');
    res.status(422).json({
      error: {
        code: 'validation_failed',
        message: 'Request validation failed',
        details: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          code: issue.code,
          message: issue.message,
        })),
        ...(requestId === undefined ? {} : { requestId }),
      },
    });
    return;
  }

  // AI failures are upstream problems, not our bugs: 503 with a clear code so
  // the UI can offer a retry instead of showing a crash.
  if (error instanceof AiValidationError) {
    req.log?.error({ ...context, issues: error.issues }, error.message);
    res.status(503).json({
      error: {
        code: 'ai_response_invalid',
        message:
          'The model did not return a usable answer. Please try again - nothing was saved.',
        details: error.issues,
        ...(requestId === undefined ? {} : { requestId }),
      },
    });
    return;
  }

  if (error instanceof AiClientError) {
    req.log?.error({ ...context, retryable: error.retryable }, error.message);
    res.status(503).json({
      error: {
        code: 'ai_unavailable',
        message: 'The AI service is unavailable right now. Please try again shortly.',
        ...(requestId === undefined ? {} : { requestId }),
      },
    });
    return;
  }

  if (error instanceof AppError) {
    if (error.statusCode >= 500) {
      req.log?.error(context, error.message);
    } else {
      req.log?.warn({ ...context, code: error.code }, error.message);
    }
    res.status(error.statusCode).json({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
        ...(requestId === undefined ? {} : { requestId }),
      },
    });
    return;
  }

  if (isEntityTooLarge(error)) {
    res.status(413).json({
      error: { code: 'payload_too_large', message: 'Request body too large', ...(requestId === undefined ? {} : { requestId }) },
    });
    return;
  }

  if (isBodyParserError(error)) {
    res.status(400).json({
      error: { code: 'bad_request', message: 'Invalid JSON body', ...(requestId === undefined ? {} : { requestId }) },
    });
    return;
  }

  req.log?.error(context, 'unhandled error');
  res.status(500).json({
    error: {
      code: 'internal_error',
      // Never leak internals to the client.
      message: 'Unexpected error',
      ...(requestId === undefined ? {} : { requestId }),
    },
  });
}

/** 404 for unmatched routes. */
export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new NotFoundError(`Cannot ${req.method} ${req.originalUrl}`));
}
