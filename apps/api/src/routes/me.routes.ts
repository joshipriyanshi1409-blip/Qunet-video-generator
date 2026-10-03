import { Router } from 'express';
import { createMeController } from '../controllers/me.controller.js';
import { requireAuth } from '../middleware/auth.js';
import type { AuthOptions } from '../middleware/auth.js';

export function createMeRouter(auth: AuthOptions): Router {
  const controller = createMeController();
  const router = Router();

  router.get('/', requireAuth(auth), controller.getMe);

  return router;
}
