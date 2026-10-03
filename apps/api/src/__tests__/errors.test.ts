import type { Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  AppError,
  BadRequestError,
  errorHandler,
  ForbiddenError,
  NotFoundError,
  notFoundHandler,
  TooManyRequestsError,
  UnauthorizedError,
  ValidationError,
} from '../lib/errors.js';

interface FakeResponse {
  statusCode: number;
  body: unknown;
  headersSent: boolean;
  status(code: number): FakeResponse;
  json(payload: unknown): FakeResponse;
}

function makeResponse(): Response {
  const response: FakeResponse = {
    statusCode: 0,
    body: undefined,
    headersSent: false,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return response as unknown as Response;
}

function makeRequest() {
  return {
    method: 'GET',
    originalUrl: '/api/v1/me',
    ip: '127.0.0.1',
    id: 'req-123',
    log: { error: vi.fn(), warn: vi.fn() },
  };
}

function readBody(res: Response): { error: { code: string; message: string; details?: unknown; requestId?: string } } {
  return (res as unknown as { body: { error: { code: string; message: string } } }).body;
}

describe('AppError subclasses', () => {
  it('carries a status code and a machine-readable code', () => {
    const cases = [
      [new BadRequestError(), 400, 'bad_request'],
      [new ValidationError(), 422, 'validation_failed'],
      [new UnauthorizedError(), 401, 'unauthorized'],
      [new ForbiddenError(), 403, 'forbidden'],
      [new NotFoundError(), 404, 'not_found'],
      [new TooManyRequestsError(), 429, 'rate_limited'],
    ] as const;

    for (const [error, statusCode, code] of cases) {
      expect(error).toBeInstanceOf(AppError);
      expect(error.statusCode).toBe(statusCode);
      expect(error.code).toBe(code);
    }
  });

  it('serializes to the documented error envelope', () => {
    const body = new NotFoundError('nope', { details: { id: '1' } }).toJSON();
    expect(body).toEqual({
      error: { code: 'not_found', message: 'nope', details: { id: '1' } },
    });
  });
});

describe('errorHandler', () => {
  it('maps a ZodError to 422 with per-field details', () => {
    const schema = z.object({ email: z.string().email() });
    const req = makeRequest();
    const res = makeResponse();

    errorHandler(schema.safeParse({ email: 'nope' }).error, req, res, vi.fn());

    expect(res.statusCode).toBe(422);
    const body = readBody(res);
    expect(body.error.code).toBe('validation_failed');
    expect(body.error.requestId).toBe('req-123');
    expect(body.error.details).toEqual([
      expect.objectContaining({ path: 'email', code: 'invalid_string' }),
    ]);
    expect(req.log.warn).toHaveBeenCalledOnce();
  });

  it('maps an AppError to its status code', () => {
    const res = makeResponse();
    errorHandler(new UnauthorizedError('no token'), makeRequest(), res, vi.fn());
    expect(res.statusCode).toBe(401);
    expect(readBody(res).error).toEqual({
      code: 'unauthorized',
      message: 'no token',
      requestId: 'req-123',
    });
  });

  it('hides internals for unexpected errors', () => {
    const req = makeRequest();
    const res = makeResponse();
    errorHandler(new Error('secret stack detail'), req, res, vi.fn());

    expect(res.statusCode).toBe(500);
    expect(readBody(res).error).toEqual({
      code: 'internal_error',
      message: 'Unexpected error',
      requestId: 'req-123',
    });
    expect(req.log.error).toHaveBeenCalledOnce();
  });

  it('maps malformed JSON bodies to 400', () => {
    const error = new SyntaxError('Unexpected token');
    (error as unknown as { body: unknown }).body = {};
    const res = makeResponse();

    errorHandler(error, makeRequest(), res, vi.fn());

    expect(res.statusCode).toBe(400);
    expect(readBody(res).error.code).toBe('bad_request');
  });

  it('maps oversized bodies to 413', () => {
    const error = new Error('too large');
    (error as unknown as { type: string }).type = 'entity.too.large';
    const res = makeResponse();

    errorHandler(error, makeRequest(), res, vi.fn());

    expect(res.statusCode).toBe(413);
    expect(readBody(res).error.code).toBe('payload_too_large');
  });

  it('delegates to next() when the response already started', () => {
    const res = makeResponse();
    (res as unknown as { headersSent: boolean }).headersSent = true;
    const next = vi.fn();

    errorHandler(new Error('boom'), makeRequest(), res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(0);
  });
});

describe('notFoundHandler', () => {
  it('forwards a 404 describing the route', () => {
    const next = vi.fn();
    notFoundHandler(
      { method: 'PATCH', originalUrl: '/nope' } as unknown as Parameters<typeof notFoundHandler>[0],
      makeResponse(),
      next,
    );
    const error = next.mock.calls[0]?.[0] as NotFoundError;
    expect(error).toBeInstanceOf(NotFoundError);
    expect(error.message).toBe('Cannot PATCH /nope');
  });
});
