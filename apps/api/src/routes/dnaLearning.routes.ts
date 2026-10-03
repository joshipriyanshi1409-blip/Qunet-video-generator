import { Router } from 'express';
import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';
import { z } from 'zod';
import { dnaSignalAppendSchema } from '@creatordna/shared';
import { createDnaLearningController } from '../controllers/dnaLearning.controller.js';
import { TooManyRequestsError } from '../lib/errors.js';
import { requireAuth, type AuthOptions } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import type { DnaLearningService } from '../services/dnaLearning.service.js';

const suggestionIdParams = z.object({ id: z.string().trim().min(1).max(128) });

/**
 * The learning loop.
 *
 * Mounted under the same `/dna` prefix as the profile router: these are all
 * operations on one creator's DNA, and splitting them across two prefixes would
 * make the client remember two base paths for one resource.
 *
 * `generate` is the expensive one - a model call - so it gets the same tighter
 * per-creator limiter the trend endpoints use. The stronger guard is in the
 * service, which refuses to call the model at all when there is nothing new to
 * reason over.
 */
export interface DnaLearningRouterOptions {
  auth: AuthOptions;
  service: DnaLearningService;
  /** Requests per window for the model-backed endpoint. */
  aiLimit: number;
  aiWindowMs: number;
}

export function createDnaLearningRouter(options: DnaLearningRouterOptions): Router {
  const controller = createDnaLearningController(options.service);
  const router = Router();

  const aiLimiter = createAiRateLimiter(options.aiLimit, options.aiWindowMs);

  router.post(
    '/signals',
    requireAuth(options.auth),
    validate({ body: dnaSignalAppendSchema }),
    controller.recordSignal,
  );

  router.get('/signals', requireAuth(options.auth), controller.listSignals);

  router.post(
    '/suggestions/generate',
    requireAuth(options.auth),
    aiLimiter,
    controller.generate,
  );

  router.get('/suggestions', requireAuth(options.auth), controller.listSuggestions);

  router.post(
    '/suggestions/:id/accept',
    requireAuth(options.auth),
    validate({ params: suggestionIdParams }),
    controller.accept,
  );

  router.post(
    '/suggestions/:id/reject',
    requireAuth(options.auth),
    validate({ params: suggestionIdParams }),
    controller.reject,
  );

  router.get('/versions', requireAuth(options.auth), controller.listVersions);

  return router;
}

/** Same shape as the trend router's limiter, so the error envelope matches. */
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
