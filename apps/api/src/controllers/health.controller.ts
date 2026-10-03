import type { RequestHandler } from 'express';
import { asyncHandler } from '../lib/http.js';
import type { HealthService } from '../services/health.service.js';

export interface HealthController {
  getHealth: RequestHandler;
  getLiveness: RequestHandler;
  getReadiness: RequestHandler;
}

export function createHealthController(service: HealthService): HealthController {
  return {
    /** Full status: process info plus dependency checks. */
    getHealth: asyncHandler(async (_req, res) => {
      res.json(await service.check());
    }),

    /** Liveness: the process is up and serving. */
    getLiveness: asyncHandler((_req, res) => {
      res.json({ status: 'ok', uptimeSeconds: Math.round(process.uptime() * 100) / 100 });
    }),

    /** Readiness: dependencies are usable (503 when degraded). */
    getReadiness: asyncHandler(async (_req, res) => {
      const readiness = await service.ready();
      res.status(readiness.status === 'ok' ? 200 : 503).json(readiness);
    }),
  };
}
