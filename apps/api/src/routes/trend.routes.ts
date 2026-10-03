import { Router } from 'express';
import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';
import { hookLabRequestSchema, trendRemixRequestSchema } from '@creatordna/shared';
import { createTrendController } from '../controllers/trend.controller.js';
import { TooManyRequestsError } from '../lib/errors.js';
import { requireAuth, type AuthOptions } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import type { TrendService } from '../services/trend.service.js';

/**
 * Trend Remix + Hook Lab routes.
 *
 * `remix` and `hooks` are the expensive ones (a model call each), so they get
 * their own tighter limiter on top of the global one. `for-me` is cached for an
 * hour per creator, so it is cheap after the first call.
 */
export interface TrendRouterOptions {
  auth: AuthOptions;
  service: TrendService;
  /** Requests per window for the model-backed endpoints. */
  aiLimit: number;
  aiWindowMs: number;
}

export function createTrendRouter(options: TrendRouterOptions): Router {
  const controller = createTrendController(options.service);
  const router = Router();

  const aiLimiter = createAiRateLimiter(options.aiLimit, options.aiWindowMs);

  /** Ranked catalogue for the signed-in creator. */
  router.get('/for-me', requireAuth(options.auth), controller.listForMe);

  /** Remix a trend (or a free-text idea) to fit the creator's DNA. */
  router.post(
    '/remix',
    requireAuth(options.auth),
    aiLimiter,
    validate({ body: trendRemixRequestSchema }),
    controller.remix,
  );

  /** Hook Lab: 5-8 hooks in distinct styles, or one when a style is named. */
  router.post(
    '/hooks',
    requireAuth(options.auth),
    aiLimiter,
    validate({ body: hookLabRequestSchema }),
    controller.hooks,
  );

  /** Idempotent catalogue seeding (also run by `scripts/seedTrends.ts`). */
  router.post('/seed', requireAuth(options.auth), controller.seed);

  return router;
}

/**
 * A limiter for the model-backed endpoints.
 *
 * The global limiter protects the process; this one protects the creator's
 * quota and the bill. It is separate because the limits come from the AI config
 * rather than the HTTP config, and the handler must produce the same error
 * envelope as everything else.
 */
function createAiRateLimiter(limit: number, windowMs: number): RateLimitRequestHandler {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, _res, next) => {
      next(
        new TooManyRequestsError(
          `AI rate limit exceeded (${limit} per ${Math.ceil(windowMs / 1000)}s).`,
          { details: { limit, windowMs } },
        ),
      );
    },
  });
}
