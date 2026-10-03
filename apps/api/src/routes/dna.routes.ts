import { Router } from 'express';
import { dnaOnboardingInputSchema, dnaUpdateRequestSchema } from '@creatordna/shared';
import { createDnaController } from '../controllers/dna.controller.js';
import { requireAuth } from '../middleware/auth.js';
import type { AuthOptions } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import type { DnaService } from '../services/dna.service.js';

/**
 * Creator DNA routes.
 *
 * `extract` is the expensive one (a model call, quota-guarded), `get`/`put` are
 * cheap reads and edits of what is already stored.
 */
export function createDnaRouter(auth: AuthOptions, service: DnaService): Router {
  const controller = createDnaController(service);
  const router = Router();

  router.post(
    '/extract',
    requireAuth(auth),
    validate({ body: dnaOnboardingInputSchema }),
    controller.extract,
  );

  router.get('/', requireAuth(auth), controller.getProfile);

  router.put(
    '/',
    requireAuth(auth),
    validate({ body: dnaUpdateRequestSchema }),
    controller.update,
  );

  /** Debug/inspection: the exact block injected into prompts. */
  router.get('/context', requireAuth(auth), controller.getContext);

  return router;
}
