import { Router } from 'express';
import { z } from 'zod';
import { renderCreateRequestSchema, renderRetryRequestSchema } from '@creatordna/shared';
import { requireAuth, type AuthOptions } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { createRenderController } from '../controllers/render.controller.js';
import type { RenderJobService } from '../services/renderJob.service.js';

/**
 * Render pipeline REST surface.
 *
 * `POST /render` starts a pipeline; `GET /render/:id` reads its document;
 * `POST /render/:id/retry` re-runs one stage. Live progress is a WebSocket
 * concern, not a REST one - polling a stage that takes ninety seconds is how a
 * progress bar ends up lying.
 */
export interface RenderRouterOptions {
  auth: AuthOptions;
  service: RenderJobService;
}

/** Job ids are BullMQ ids: numeric or a short custom string. */
const jobIdParams = z.object({ id: z.string().trim().min(1).max(128) });

export function createRenderRouter(options: RenderRouterOptions): Router {
  const controller = createRenderController(options.service);
  const router = Router();

  router.post(
    '/',
    requireAuth(options.auth),
    validate({ body: renderCreateRequestSchema }),
    controller.create,
  );

  router.get('/:id', requireAuth(options.auth), validate({ params: jobIdParams }), controller.status);

  router.post(
    '/:id/retry',
    requireAuth(options.auth),
    validate({ params: jobIdParams, body: renderRetryRequestSchema }),
    controller.retry,
  );

  return router;
}
