import type { Request, RequestHandler } from 'express';
import type { z } from 'zod';

export interface ValidationSchemas {
  body?: z.ZodType;
  query?: z.ZodType;
  params?: z.ZodType;
}

/**
 * `req.query` is a getter in Express 5, so a plain assignment throws.
 * Define an own property on the request instead.
 */
function replaceRequestValue(req: Request, key: 'body' | 'query' | 'params', value: unknown): void {
  Object.defineProperty(req, key, {
    value,
    writable: true,
    configurable: true,
    enumerable: true,
  });
}

/**
 * Validates and replaces `body` / `query` / `params` with the parsed result.
 * Zod errors bubble up to the centralized error middleware as `422`.
 */
export function validate(schemas: ValidationSchemas): RequestHandler {
  return (req, _res, next) => {
    try {
      if (schemas.body !== undefined) {
        replaceRequestValue(req, 'body', schemas.body.parse(req.body));
      }
      if (schemas.query !== undefined) {
        replaceRequestValue(req, 'query', schemas.query.parse(req.query));
      }
      if (schemas.params !== undefined) {
        replaceRequestValue(req, 'params', schemas.params.parse(req.params));
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
