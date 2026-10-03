import type { RequestHandler } from 'express';
import {
  renderCreateRequestSchema,
  renderRetryRequestSchema,
  type RenderCreateRequest,
  type RenderJobAccepted,
  type RenderStage,
} from '@creatordna/shared';
import { UnauthorizedError } from '../lib/errors.js';
import { asyncHandler } from '../lib/http.js';
import type { RenderJobService } from '../services/renderJob.service.js';

/**
 * Render pipeline controllers: request/response shaping only.
 *
 * Every body has already been through `validate({ body })`, so parsing again is
 * what gives the service a typed value - and a second parse is cheap insurance
 * against a route that forgot to validate.
 */
export interface RenderController {
  create: RequestHandler;
  status: RequestHandler;
  retry: RequestHandler;
}

export function createRenderController(service: RenderJobService): RenderController {
  return {
    /** POST /render - accept an approved script and start the pipeline. */
    create: asyncHandler(async (req, res) => {
      const user = req.user;
      if (user === undefined) throw new UnauthorizedError();

      const payload = renderCreateRequestSchema.parse(req.body as unknown) as RenderCreateRequest;
      const accepted: RenderJobAccepted = await service.create(payload, user.uid);

      // 202, not 201: the render has been accepted, not produced. The MP4 does
      // not exist yet and this response must not imply that it does.
      res.status(202).json(accepted);
    }),

    /** GET /render/:id - the job document, for a browser that reconnected. */
    status: asyncHandler(async (req, res) => {
      const user = req.user;
      if (user === undefined) throw new UnauthorizedError();

      const jobId = req.params.id;
      if (typeof jobId !== 'string') throw new UnauthorizedError();

      res.json(await service.getStatus(jobId, user.uid));
    }),

    /** POST /render/:id/retry - re-run one stage, keeping earlier assets. */
    retry: asyncHandler(async (req, res) => {
      const user = req.user;
      if (user === undefined) throw new UnauthorizedError();

      const jobId = req.params.id;
      if (typeof jobId !== 'string') throw new UnauthorizedError();

      const body = renderRetryRequestSchema.parse(req.body as unknown);
      const stage: RenderStage | undefined = body.fromStage;

      res.status(202).json(await service.retry(jobId, user.uid, stage));
    }),
  };
}
