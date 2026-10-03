import { Router } from 'express';
import { idSchema, pingJobPayloadSchema } from '@creatordna/shared';
import { z } from 'zod';
import { createJobsController } from '../controllers/jobs.controller.js';
import { requireAuth } from '../middleware/auth.js';
import type { AuthOptions } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import type { PingJobService } from '../services/pingJob.service.js';
import type { RenderJobService } from '../services/renderJob.service.js';

export function createJobsRouter(
  auth: AuthOptions,
  service: PingJobService,
  /** Optional: when absent, an unknown job id stays a 404 instead of a 503. */
  renderJobs?: RenderJobService,
): Router {
  const controller = createJobsController(service, renderJobs);
  const router = Router();

  router.post(
    '/ping',
    requireAuth(auth),
    validate({ body: pingJobPayloadSchema }),
    controller.enqueuePing,
  );

  router.get(
    '/:jobId',
    requireAuth(auth),
    validate({ params: z.object({ jobId: idSchema }) }),
    controller.getJob,
  );

  return router;
}
