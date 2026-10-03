import type { RequestHandler } from 'express';
import type { LiveFeedbackRequest } from '@creatordna/shared';
import { UnauthorizedError } from '../lib/errors.js';
import { asyncHandler } from '../lib/http.js';
import type { VoiceCoachService } from '../voiceCoach/service.js';

export interface VoiceCoachController {
  feedback: RequestHandler;
  quota: RequestHandler;
}

export function createVoiceCoachController(service: VoiceCoachService): VoiceCoachController {
  return {
    /** POST /voice-coach/feedback - post-recording coaching. */
    feedback: asyncHandler(async (req, res) => {
      const user = req.user;
      if (user === undefined) throw new UnauthorizedError();

      // Already validated by `validate({ body })`; the cast is what gives the
      // service a typed value.
      const request = req.body as LiveFeedbackRequest;

      res.json({ data: await service.feedback(user.uid, request) });
    }),

    /** GET /voice-coach/quota - sessions left today. */
    quota: asyncHandler((req, res) => {
      const user = req.user;
      if (user === undefined) throw new UnauthorizedError();

      res.json({ data: service.quota(user.uid) });
    }),
  };
}
