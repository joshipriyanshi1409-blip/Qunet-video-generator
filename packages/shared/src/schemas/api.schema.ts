import { z } from 'zod';
import { idSchema, isoDateTimeSchema, jobStateSchema } from './common.schema.js';
import {
  renderAssetSchema,
  renderCreateRequestSchema,
  renderJobErrorSchema,
  renderStageSchema,
} from './renderJob.schema.js';

/** Payload of the demo `ping` job used to prove the queue + worker wiring. */
export const pingJobPayloadSchema = z.object({
  message: z.string().trim().min(1).max(200).default('ping'),
  delayMs: z.coerce.number().int().min(0).max(10_000).default(0),
  /** Fail the first N attempts - handy to demonstrate "retry only the failed stage". */
  failFirstAttempts: z.coerce.number().int().min(0).max(3).default(0),
});

/** Exactly what is stored in Redis for a ping job (shared by api + worker). */
export const pingJobDataSchema = pingJobPayloadSchema.extend({ uid: idSchema });

export const pingJobResultSchema = z.object({
  message: z.string().trim().min(1).max(200),
  finishedAt: isoDateTimeSchema,
  attempts: z.number().int().nonnegative(),
});

export const enqueuePingResponseSchema = z.object({
  jobId: z.string().trim().min(1),
  queue: z.string().trim().min(1),
  state: z.string().trim().min(1),
});

/**
 * Payload of a `render` job: the approved project's script, ready for the
 * worker's pipeline. `uid` is stamped by the API, never by the client.
 */
/** Alias kept for the queue payload: one shape, defined with the render routes. */
export const renderJobPayloadSchema = renderCreateRequestSchema;

/** Exactly what is stored in Redis for a render job (shared by api + worker). */
export const renderJobDataSchema = renderJobPayloadSchema.extend({ uid: idSchema });

/** What the worker will eventually return for a render job (Phase 6). */
export const renderJobResultSchema = z.object({
  stage: z.enum(['completed', 'failed']),
  message: z.string().trim().min(1).max(300),
  /** Firebase Storage path of the finished MP4, once there is one. */
  outputPath: z.string().trim().min(1).max(500).optional(),
});

/** GET /api/v1/jobs/:jobId response. */
export const jobStatusResponseSchema = z.object({
  jobId: z.string().trim().min(1),
  name: z.string().trim().min(1),
  state: jobStateSchema,
  progress: z.union([z.number(), z.string(), z.record(z.string(), z.unknown())]),
  attemptsMade: z.number().int().nonnegative(),
  failedReason: z.string().nullable(),
  returnvalue: z.unknown().nullable(),
  data: z.record(z.string(), z.unknown()),
  /** Render pipeline fields. Absent for a job that predates the pipeline. */
  stage: renderStageSchema.optional(),
  assets: z.array(renderAssetSchema).default([]),
  error: renderJobErrorSchema.nullable().default(null),
});

/** GET /api/v1/me response - proves the Firebase token was verified. */
export const meResponseSchema = z.object({
  uid: idSchema,
  email: z.string().email().optional(),
  emailVerified: z.boolean(),
  devAuthBypass: z.boolean(),
  claims: z.record(z.string(), z.unknown()),
});

export type PingJobPayload = z.infer<typeof pingJobPayloadSchema>;
export type PingJobData = z.infer<typeof pingJobDataSchema>;
export type RenderJobPayload = z.infer<typeof renderJobPayloadSchema>;
export type RenderJobResult = z.infer<typeof renderJobResultSchema>;
export type RenderJobData = z.infer<typeof renderJobDataSchema>;
export type PingJobResult = z.infer<typeof pingJobResultSchema>;
export type EnqueuePingResponse = z.infer<typeof enqueuePingResponseSchema>;
export type JobStatusResponse = z.infer<typeof jobStatusResponseSchema>;
export type MeResponse = z.infer<typeof meResponseSchema>;
