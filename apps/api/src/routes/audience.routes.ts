import { Router } from 'express';
import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';
import {
  audienceMirrorRequestSchema,
  improveRequestSchema,
  projectSchema,
  renderJobPayloadSchema,
} from '@creatordna/shared';
import { z } from 'zod';
import { createAudienceController } from '../controllers/audience.controller.js';
import { TooManyRequestsError } from '../lib/errors.js';
import { requireAuth, type AuthOptions } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import type { AudienceService } from '../services/audience.service.js';
import type { RenderJobService } from '../services/renderJob.service.js';

/**
 * Audience Mirror + the improve/approve loop.
 *
 * `mirror` and `improve` are model-backed, so they share the same tighter limiter
 * the trend endpoints use: the global limiter protects the process, this one
 * protects the creator's quota and the bill. `approve` enqueues a render job and
 * needs no AI call, so it only gets the global limiter.
 */
export interface AudienceRouterOptions {
  auth: AuthOptions;
  service: AudienceService;
  renderJobs: RenderJobService;
  /** Requests per window for the model-backed endpoints. */
  aiLimit: number;
  aiWindowMs: number;
}

const projectIdParams = z.object({ projectId: projectSchema.shape.id });

export function createAudienceRouter(options: AudienceRouterOptions): Router {
  const controller = createAudienceController({
    service: options.service,
    renderJobs: options.renderJobs,
  });
  const router = Router();
  const aiLimiter = createAiRateLimiter(options.aiLimit, options.aiWindowMs);

  router.post(
    '/audience-mirror',
    requireAuth(options.auth),
    aiLimiter,
    validate({ body: audienceMirrorRequestSchema }),
    controller.mirror,
  );

  router.post(
    '/improve',
    requireAuth(options.auth),
    aiLimiter,
    validate({ body: improveRequestSchema }),
    controller.improve,
  );

  /** Read one project, so a reload does not lose the loop. */
  router.get(
    '/projects/:projectId',
    requireAuth(options.auth),
    validate({ params: projectIdParams }),
    controller.getProject,
  );

  /**
   * Approve the newest version and enqueue the render.
   *
   * The body is the approved script, so what gets rendered is exactly what the
   * creator saw and approved - not a re-read of the project that could have moved
   * on in between.
   */
  router.post(
    '/projects/:projectId/approve',
    requireAuth(options.auth),
    validate({ params: projectIdParams, body: renderJobPayloadSchema }),
    controller.approve,
  );

  return router;
}

/** A limiter for the model-backed endpoints, producing the shared error envelope. */
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
