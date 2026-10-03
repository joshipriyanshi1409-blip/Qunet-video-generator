import { z } from 'zod';
import type { reactionLevelSchema } from './common.schema.js';
import { audienceSegmentSchema } from './dna.schema.js';

/** Mandatory disclaimer copy - the Audience Mirror is analysis, not a promise. */
export const AI_PREDICTION_DISCLAIMER =
  'AI analysis, not a guaranteed prediction.';

/**
 * How interested one segment is likely to be.
 *
 * The wire format is the label the creator reads, not an internal enum: the
 * brief specifies `"High" | "Medium" | "Low"`, and keeping the API honest about
 * its own presentation avoids a second translation layer on the client.
 */
export const interestLevelSchema = z.enum(['High', 'Medium', 'Low']);

export const INTEREST_LEVELS = interestLevelSchema.options;

/** Maps a wire interest level onto the shared lowercase reaction vocabulary. */
export const INTEREST_TO_REACTION: Readonly<
  Record<z.infer<typeof interestLevelSchema>, z.infer<typeof reactionLevelSchema>>
> = {
  High: 'high',
  Medium: 'medium',
  Low: 'low',
};

/** One segment's predicted reaction, with the reason and the fix. */
export const audienceSegmentPredictionSchema = z.object({
  segmentName: audienceSegmentSchema,
  interest: interestLevelSchema,
  reason: z.string().trim().min(1).max(400),
  tip: z.string().trim().min(1).max(400),
});

/**
 * The Audience Mirror answer: per-segment predictions, a cross-segment insight,
 * and a rewritten CTA. `disclaimer` is defaulted so it can never be dropped.
 */
export const audienceMirrorResultSchema = z.object({
  predictions: z.array(audienceSegmentPredictionSchema).min(1).max(8),
  overallInsight: z.string().trim().min(1).max(600),
  improvedCta: z.string().trim().min(1).max(300),
  disclaimer: z.string().trim().min(1).max(200).default(AI_PREDICTION_DISCLAIMER),
});

/**
 * Request body for the Audience Mirror.
 *
 * `content` is what is being tested (a hook, a script, or both); `hook` and
 * `cta` are the two lines the mirror comments on and that `/improve` rewrites.
 */
export const audienceMirrorRequestSchema = z.object({
  content: z.string().trim().min(1).max(2000),
  hook: z.string().trim().min(1).max(300),
  cta: z.string().trim().min(1).max(300),
  /** Existing project to append this iteration to; omitted creates one. */
  projectId: z.string().trim().min(1).max(128).optional(),
  /** Trend the content came from, when it did. */
  trendId: z.string().trim().min(1).max(128).optional(),
  /** Override the DNA's audience segments for this test only. */
  segments: z.array(audienceSegmentSchema).min(1).max(8).optional(),
});

/** What `/improve` rewrites. */
export const improveTargetSchema = z.enum(['hook', 'cta']);

/**
 * Request body for `/improve`.
 *
 * `feedback` carries the segment tips that drove this revision, so the next
 * version records *why* the copy changed and not just that it did.
 */
export const improveRequestSchema = z.object({
  projectId: z.string().trim().min(1).max(128),
  target: improveTargetSchema,
  feedback: z.array(z.string().trim().min(1).max(400)).max(8).default([]),
  /** Re-run the mirror after rewriting, so the effect is visible immediately. */
  recheck: z.boolean().default(true),
});

/** One stored iteration of a project. */
export const projectVersionSchema = z.object({
  version: z.number().int().min(1),
  kind: z.enum(['remix', 'mirror', 'improve']),
  hook: z.string().trim().min(1).max(300),
  cta: z.string().trim().min(1).max(300),
  content: z.string().trim().min(1).max(2000),
  script: z
    .array(
      z.object({
        scene: z.string().trim().min(1).max(120),
        text: z.string().trim().min(1).max(4000),
      }),
    )
    .max(12)
    .optional(),
  mirror: audienceMirrorResultSchema.optional(),
  improvedCta: z.string().trim().min(1).max(300).optional(),
  feedback: z.array(z.string().trim().min(1).max(400)).max(8).default([]),
  createdAt: z.string().datetime({ offset: true }),
});

/** The project document: one creator's idea through remix, mirror and approval. */
export const projectSchema = z.object({
  id: z.string().trim().min(1).max(128),
  uid: z.string().trim().min(1).max(128),
  idea: z.string().trim().min(1).max(2000),
  trendId: z.string().trim().min(1).max(128).nullable().default(null),
  status: z
    .enum(['draft', 'awaiting-approval', 'approved', 'rendering', 'rendered'])
    .default('draft'),
  versions: z.array(projectVersionSchema).max(50).default([]),
  /** The version the creator approved, once they have. */
  approvedVersion: z.number().int().min(1).nullable().default(null),
  /** BullMQ job id, set when the project is approved and queued for render. */
  renderJobId: z.string().trim().min(1).max(128).nullable().default(null),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

/** Response of `POST /audience-mirror`: the project plus the fresh mirror. */
export const audienceMirrorResponseSchema = z.object({
  project: projectSchema,
  mirror: audienceMirrorResultSchema,
});

/** Response of `POST /improve`: the project plus what was rewritten. */
export const improveResponseSchema = z.object({
  project: projectSchema,
  target: improveTargetSchema,
  improved: z.object({
    hook: z.string().trim().min(1).max(300),
    cta: z.string().trim().min(1).max(300),
  }),
  /** Present when `recheck` was true. */
  mirror: audienceMirrorResultSchema.optional(),
});

export type InterestLevel = z.infer<typeof interestLevelSchema>;
export type AudienceSegmentPrediction = z.infer<typeof audienceSegmentPredictionSchema>;
export type AudienceMirrorResult = z.infer<typeof audienceMirrorResultSchema>;
export type AudienceMirrorRequest = z.infer<typeof audienceMirrorRequestSchema>;
export type ImproveTarget = z.infer<typeof improveTargetSchema>;
export type ImproveRequest = z.infer<typeof improveRequestSchema>;
export type ProjectVersion = z.infer<typeof projectVersionSchema>;
export type Project = z.infer<typeof projectSchema>;
export type ProjectStatus = z.infer<typeof projectSchema>['status'];
export type AudienceMirrorResponse = z.infer<typeof audienceMirrorResponseSchema>;
export type ImproveResponse = z.infer<typeof improveResponseSchema>;

/** What the render queue reports back when a job is enqueued. */
export const enqueuedRenderJobSchema = z.object({
  jobId: z.string().trim().min(1),
  queue: z.string().trim().min(1),
  state: z.string().trim().min(1),
});

/** Response of `POST /projects/:projectId/approve`: the job plus the project. */
export const projectApprovalResponseSchema = z.object({
  project: projectSchema,
  job: enqueuedRenderJobSchema,
});

export type EnqueuedRenderJob = z.infer<typeof enqueuedRenderJobSchema>;
export type ProjectApprovalResponse = z.infer<typeof projectApprovalResponseSchema>;
