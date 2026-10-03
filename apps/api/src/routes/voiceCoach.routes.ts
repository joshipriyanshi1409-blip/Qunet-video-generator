import { Router } from 'express';
import { liveFeedbackRequestSchema } from '@creatordna/shared';
import { createVoiceCoachController } from '../controllers/voiceCoach.controller.js';
import { requireAuth, type AuthOptions } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import type { VoiceCoachService } from '../voiceCoach/service.js';

/**
 * Live Voice Coach REST surface.
 *
 * Only the fallback path lives here. The live coaching itself is a WebSocket on
 * `/ws/voice-coach`, because a session is a stream, not a request - putting it
 * behind REST would mean the browser polling for tips it already missed.
 */
export interface VoiceCoachRouterOptions {
  auth: AuthOptions;
  service: VoiceCoachService;
}

export function createVoiceCoachRouter(options: VoiceCoachRouterOptions): Router {
  const controller = createVoiceCoachController(options.service);
  const router = Router();

  /**
   * `POST /voice-coach/feedback` - coach a take after the fact.
   *
   * This is the fallback for when the live path is unavailable, and a first-class
   * path in its own right: some creators would rather record a whole take and
   * read the notes than be coached mid-sentence.
   */
  router.post(
    '/feedback',
    requireAuth(options.auth),
    validate({ body: liveFeedbackRequestSchema }),
    controller.feedback,
  );

  /** `GET /voice-coach/quota` - what the creator has left today. */
  router.get('/quota', requireAuth(options.auth), controller.quota);

  return router;
}
