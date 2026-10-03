import { z } from 'zod';
import { isoDateTimeSchema } from './common.schema.js';

export const healthCheckStatusSchema = z.enum(['ok', 'error', 'not_configured', 'disabled']);

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.string().trim().min(1),
  version: z.string().trim().min(1),
  environment: z.string().trim().min(1),
  uptimeSeconds: z.number().nonnegative(),
  timestamp: isoDateTimeSchema,
  checks: z.record(z.string(), healthCheckStatusSchema),
});

export const readinessResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  checks: z.record(z.string(), healthCheckStatusSchema),
});

export type HealthCheckStatus = z.infer<typeof healthCheckStatusSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;
