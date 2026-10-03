import type { RequestHandler } from 'express';
import {
  audienceMirrorRequestSchema,
  improveRequestSchema,
  renderJobPayloadSchema,
  type AudienceMirrorRequest,
  type ImproveRequest,
} from '@creatordna/shared';
import { UnauthorizedError, ValidationError } from '../lib/errors.js';
import { asyncHandler } from '../lib/http.js';
import type { AudienceService } from '../services/audience.service.js';
import type { RenderJobService } from '../services/renderJob.service.js';

export interface AudienceController {
  mirror: RequestHandler;
  improve: RequestHandler;
  getProject: RequestHandler;
  approve: RequestHandler;
}

export interface AudienceControllerDeps {
  service: AudienceService;
  renderJobs: RenderJobService;
}

export function createAudienceController(deps: AudienceControllerDeps): AudienceController {
  const { service, renderJobs } = deps;

  return {
    /** POST /audience-mirror - judge one piece of content against the DNA. */
    mirror: asyncHandler(async (req, res) => {
      const user = req.user;
      if (user === undefined) throw new UnauthorizedError();

      const request: AudienceMirrorRequest = audienceMirrorRequestSchema.parse(req.body as unknown);
      const result = await service.mirror(user.uid, request);
      res.json({ data: result });
    }),

    /** POST /improve - rewrite the hook or CTA from the mirror's feedback. */
    improve: asyncHandler(async (req, res) => {
      const user = req.user;
      if (user === undefined) throw new UnauthorizedError();

      const request: ImproveRequest = improveRequestSchema.parse(req.body as unknown);
      const result = await service.improve(user.uid, request);
      res.json({ data: result });
    }),

    /** GET /projects/:projectId - resume a loop after a reload. */
    getProject: asyncHandler(async (req, res) => {
      const user = req.user;
      if (user === undefined) throw new UnauthorizedError();

      const projectId = req.params.projectId;
      if (typeof projectId !== 'string') {
        throw new ValidationError('projectId path parameter is required.');
      }

      res.json({ data: await service.get(projectId, user.uid) });
    }),

    /**
     * POST /projects/:projectId/approve - mark the project approved and enqueue
     * the render job for the script in the body.
     *
     * The body is the approved script rather than a bare "yes", so the job carries
     * exactly what the creator saw. The API never renders anything itself.
     */
    approve: asyncHandler(async (req, res) => {
      const user = req.user;
      if (user === undefined) throw new UnauthorizedError();

      const projectId = req.params.projectId;
      if (typeof projectId !== 'string') {
        throw new ValidationError('projectId path parameter is required.');
      }

      const payload = renderJobPayloadSchema.parse({
        ...(req.body as Record<string, unknown>),
        projectId,
      });

      const { project, job } = await service.approve(user.uid, projectId, payload, renderJobs);
      res.json({ data: { project, job } });
    }),
  };
}
