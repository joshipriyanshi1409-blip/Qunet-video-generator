import { z } from 'zod';
import { creatorDnaSchema } from './dna.schema.js';
import { idSchema, isoDateTimeSchema, jobStateSchema } from './common.schema.js';

/**
 * Render pipeline contracts.
 *
 * A render is a *pipeline*, not a task: eight stages that each produce an asset
 * the next one reads. That shape drives everything here - the job document
 * carries `assets` so a failed stage can be retried without redoing the ones
 * before it, and progress is per stage rather than one number that jumps.
 */

/** Ordered pipeline stages for a render job. */
export const renderStageSchema = z.enum([
  'queued',
  'script',
  'storyboard',
  'assets',
  'voice',
  'music',
  'captions',
  'compose',
  'qc',
  'completed',
  'failed',
]);

export const renderAssetKindSchema = z.enum([
  'storyboard',
  'clip',
  'voice',
  'music',
  'captions',
  'mp4',
  'thumbnail',
]);

/**
 * Absolute URL, or a root-relative path.
 *
 * Firebase Storage hands back an absolute URL. The local-filesystem store hands
 * back a path like `/api/v1/render-assets/renders/...` that the API serves in
 * development - and a browser resolves either one, so demanding an absolute URL
 * here would force the dev store to invent an origin it does not know.
 */
const ASSET_URL = /^[a-z][a-z0-9+.-]*:\/\/\S+$/i;

export const renderAssetSchema = z.object({
  kind: renderAssetKindSchema,
  /** Firebase Storage path - the source of truth for retries. */
  storagePath: z.string().trim().min(1).max(500),
  url: z
    .string()
    .trim()
    .min(1)
    .max(2000)
    .refine((value) => value.startsWith('/') || ASSET_URL.test(value), {
      message: 'must be an absolute URL or a root-relative path',
    })
    .optional(),
  sceneIndex: z.number().int().min(0).optional(),
  mimeType: z.string().trim().min(1).max(120).optional(),
  bytes: z.number().int().nonnegative().optional(),
  createdAt: isoDateTimeSchema.optional(),
});

export const renderJobErrorSchema = z.object({
  stage: renderStageSchema,
  message: z.string().trim().min(1).max(1000),
  attempts: z.number().int().nonnegative(),
  retryable: z.boolean(),
});

/** Firestore document at `renderJobs/{jobId}`. */
export const renderJobSchema = z.object({
  jobId: idSchema,
  uid: idSchema,
  queue: z.string().trim().min(1).max(60),
  state: jobStateSchema,
  stage: renderStageSchema,
  progress: z.number().min(0).max(100),
  assets: z.array(renderAssetSchema).default([]),
  error: renderJobErrorSchema.nullable().default(null),
  attemptsMade: z.number().int().nonnegative().default(0),
  /**
   * The job payload, kept on the document.
   *
   * A retry has to be able to re-enqueue without the queue still holding the
   * original job - BullMQ evicts finished jobs, and a job retried three days
   * later must not lose the script it was rendering.
   */
  payload: z.record(z.string(), z.unknown()),
  /**
   * The Creator DNA this render was started against, snapshotted at accept time.
   *
   * It is on the document rather than read live for two reasons. The render has
   * to be *reproducible*: a job retried next month must produce the same
   * storyboard it would have produced today, even if the creator has since
   * rewritten their profile. And it has to be *auditable*: when a creator asks
   * why a video sounded unlike them, the answer is the exact profile that was
   * injected, not whatever the profile happens to be now.
   *
   * Null when the creator had no profile yet - the storyboard prompt then says
   * `unknown` for each field rather than inventing a voice.
   */
  dna: creatorDnaSchema.nullable().default(null),
  createdAt: isoDateTimeSchema.optional(),
  updatedAt: isoDateTimeSchema.optional(),
});

/** Live progress payload pushed over WebSocket while a render runs. */
export const renderProgressEventSchema = z.object({
  type: z.literal('render.progress'),
  jobId: idSchema,
  stage: renderStageSchema,
  progress: z.number().min(0).max(100),
  message: z.string().trim().min(1).max(300).optional(),
});

/** The browser asks to hear about one job. Never a list: one socket, one job. */
export const renderSubscribeSchema = z.object({
  type: z.literal('render.subscribe'),
  jobId: idSchema,
});

export const renderUnsubscribeSchema = z.object({
  type: z.literal('render.unsubscribe'),
  jobId: idSchema,
});

/**
 * `POST /render` body.
 *
 * The approved script is sent as it was approved, so what gets rendered is
 * exactly what the creator saw - not a re-read of the project, which could have
 * moved on in between.
 */
export const renderCreateRequestSchema = z.object({
  projectId: idSchema,
  hook: z.string().trim().min(1).max(300),
  script: z
    .array(
      z.object({
        scene: z.string().trim().min(1).max(120),
        text: z.string().trim().min(1).max(4000),
      }),
    )
    .min(1)
    .max(12),
  cta: z.string().trim().min(1).max(300),
  caption: z.string().trim().min(1).max(600).optional(),
  hashtags: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
  /** The DNA version this script was written against, for reproducibility. */
  dnaVersion: z.number().int().min(1).optional(),
  /** Content format id that influenced the script generation. */
  contentFormatId: z.string().trim().min(1).max(40).optional(),
});

/**
 * `POST /render/:id/retry`.
 *
 * `fromStage` defaults to the stage the job failed in, which is the only thing a
 * retry may ever do: re-running an earlier stage would throw away assets the
 * creator already paid for.
 */
export const renderRetryRequestSchema = z.object({
  fromStage: renderStageSchema.optional(),
});

/** What `POST /render` and `POST /render/:id/retry` answer with. */
export const renderJobAcceptedSchema = z.object({
  jobId: idSchema,
  queue: z.string().trim().min(1).max(60),
  state: jobStateSchema,
  stage: renderStageSchema,
  progress: z.number().min(0).max(100),
  /** True when this retry skipped stages whose assets were already on the job. */
  resumedFromAssets: z.boolean(),
});

export type RenderStage = z.infer<typeof renderStageSchema>;
export type RenderAssetKind = z.infer<typeof renderAssetKindSchema>;
export type RenderAsset = z.infer<typeof renderAssetSchema>;
export type RenderJobError = z.infer<typeof renderJobErrorSchema>;
export type RenderJob = z.infer<typeof renderJobSchema>;
export type RenderProgressEvent = z.infer<typeof renderProgressEventSchema>;
export type RenderSubscribe = z.infer<typeof renderSubscribeSchema>;
export type RenderUnsubscribe = z.infer<typeof renderUnsubscribeSchema>;
export type RenderCreateRequest = z.infer<typeof renderCreateRequestSchema>;
export type RenderRetryRequest = z.infer<typeof renderRetryRequestSchema>;
export type RenderJobAccepted = z.infer<typeof renderJobAcceptedSchema>;
