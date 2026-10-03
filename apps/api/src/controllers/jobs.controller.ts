import type { RequestHandler } from 'express';
import { enqueuePingResponseSchema, pingJobPayloadSchema } from '@creatordna/shared';
import { UnauthorizedError, ValidationError } from '../lib/errors.js';
import { asyncHandler } from '../lib/http.js';
import type { PingJobService } from '../services/pingJob.service.js';
import type { RenderJobService } from '../services/renderJob.service.js';

export interface JobsController {
  enqueuePing: RequestHandler;
  getJob: RequestHandler;
}

export function createJobsController(
  service: PingJobService,
  renderJobs?: RenderJobService,
): JobsController {
  return {
    /** POST /jobs/ping - enqueue the demo job that proves the queue wiring. */
    enqueuePing: asyncHandler(async (req, res) => {
      const user = req.user;
      if (user === undefined) throw new UnauthorizedError();

      // Already validated by the route's `validate({ body })` middleware; parsing
      // again is what gives the controller a typed value.
      const payload = pingJobPayloadSchema.parse(req.body as unknown);
      const enqueued = await service.enqueue(payload, user.uid);

      res.status(202).json(enqueuePingResponseSchema.parse(enqueued));
    }),

    /**
     * GET /jobs/:jobId - live state of one of *my* jobs.
     *
     * A job id alone does not say which queue it came from, so the render queue
     * is checked when the ping queue has no such job. Both services refuse a job
     * that belongs to another creator, so this cannot leak one.
     */
    getJob: asyncHandler(async (req, res) => {
      const user = req.user;
      if (user === undefined) throw new UnauthorizedError();

      const jobId = req.params.jobId;
      if (typeof jobId !== 'string') {
        throw new ValidationError('jobId path parameter is required.');
      }

      try {
        res.json(await service.getStatus(jobId, user.uid));
      } catch (error) {
        // Only fall through to the render queue when there is one; without it an
        // unknown job id must stay a 404 rather than becoming a 503.
        if (isNotFound(error) === false || renderJobs === undefined) throw error;
        res.json(await renderJobs.getStatus(jobId, user.uid));
      }
    }),
  };
}

/** True when the error is a 404, i.e. "not on that queue". */
function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    (error as { statusCode: unknown }).statusCode === 404
  );
}
