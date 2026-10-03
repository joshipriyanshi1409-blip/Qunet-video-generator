import type { NextFunction, Request, RequestHandler, Response } from 'express';

type Handler = (req: Request, res: Response, next: NextFunction) => void | Promise<void>;

/**
 * Wraps a handler so a rejected promise reaches the centralized error
 * middleware instead of becoming an unhandled rejection.
 */
export function asyncHandler(handler: Handler): RequestHandler {
  return (req, res, next) => {
    // Sync handlers are allowed: `Promise.resolve` normalises both shapes.
    void Promise.resolve(handler(req, res, next)).catch(next);
  };
}
