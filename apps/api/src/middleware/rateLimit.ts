import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';
import { TooManyRequestsError } from '../lib/errors.js';
import type { AppConfig } from '../config/index.js';

/**
 * Global rate limiter (engineering rule 7). Per-user daily quotas for AI work are
 * enforced in the worker; this protects the API process itself.
 */
export function createRateLimiter(config: AppConfig): RateLimitRequestHandler {
  return rateLimit({
    windowMs: config.env.RATE_LIMIT_WINDOW_MS,
    limit: config.env.RATE_LIMIT_MAX,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Never let tests fail because of the limiter.
    skip: () => config.isTest,
    handler: (_req, _res, next) => {
      const limit = config.env.RATE_LIMIT_MAX;
      const windowMs = config.env.RATE_LIMIT_WINDOW_MS;
      next(
        new TooManyRequestsError(`Rate limit exceeded (${limit} per ${Math.ceil(windowMs / 1000)}s).`, {
          details: { limit, windowMs },
        }),
      );
    },
  });
}
