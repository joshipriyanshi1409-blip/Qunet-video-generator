import { Router } from 'express';
import { createHealthController } from '../controllers/health.controller.js';
import type { HealthService } from '../services/health.service.js';

/** Health endpoints live at the root (`/health`), outside the API prefix. */
export function createHealthRouter(service: HealthService): Router {
  const controller = createHealthController(service);
  const router = Router();

  router.get('/', controller.getHealth);
  router.get('/live', controller.getLiveness);
  router.get('/ready', controller.getReadiness);

  return router;
}
