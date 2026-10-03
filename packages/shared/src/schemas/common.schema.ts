import { z } from 'zod';

/** ISO-8601 timestamp string, e.g. `2026-10-02T10:00:00.000Z`. */
export const isoDateTimeSchema = z.string().datetime({ offset: true });

/** Firestore document id / generic opaque id. */
export const idSchema = z.string().trim().min(1).max(128);

/** Short single-line text (titles, hooks, labels). */
export const shortTextSchema = z.string().trim().min(1).max(120);

/** Longer free-form text (scripts, descriptions, reasons). */
export const longTextSchema = z.string().trim().min(1).max(4000);

/** A single vocabulary word / catchphrase / rule. */
export const tagSchema = z.string().trim().min(1).max(40);

/**
 * `process.env` only ever contains strings, so booleans need an explicit
 * transform. `z.coerce.boolean()` is a trap here: Boolean('false') === true.
 */
export const booleanFromEnvSchema = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0', 'yes', 'no', 'on', 'off'])])
  .transform(
    (value) =>
      value === true ||
      value === 'true' ||
      value === '1' ||
      value === 'yes' ||
      value === 'on',
  );

/**
 * `.env` files leave optional values blank (`FOO=`), which `process.env` exposes
 * as an empty string rather than "absent". Humans mean "unset", so normalise a
 * blank value to `undefined` before the real schema sees it:
 *
 *   FIREBASE_PROJECT_ID: z.preprocess(blankEnvToUndefined, z.string().optional())
 *
 * Without this, copying `.env.example` to `.env` fails env validation at boot.
 */
export function blankEnvToUndefined(value: unknown): unknown {
  return typeof value === 'string' && value.trim() === '' ? undefined : value;
}

/** A bounded list of tags. */
export const tagListSchema = z.array(tagSchema).max(40);

/**
 * Predicted reaction strength used by Hook Lab / Audience Mirror.
 * Always presented to the user as AI analysis, never as a guarantee.
 */
export const reactionLevelSchema = z.enum(['high', 'medium', 'low']);

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().trim().min(1).max(256).optional(),
});

/**
 * Standard success envelope: `{ data, meta? }`.
 * Build one per endpoint so the response body stays validated end to end.
 */
export function apiEnvelopeSchema<T extends z.ZodTypeAny>(data: T) {
  return z.object({
    data,
    meta: z.record(z.string(), z.unknown()).optional(),
  });
}

/** Standard error envelope produced by the API error middleware. */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
    requestId: z.string().optional(),
  }),
});

/** BullMQ `Job.getState()` values. */
export const jobStateSchema = z.enum([
  'completed',
  'failed',
  'delayed',
  'active',
  'waiting',
  'waiting-children',
  'prioritized',
  'unknown',
]);

export type ReactionLevel = z.infer<typeof reactionLevelSchema>;
export type Pagination = z.infer<typeof paginationSchema>;
export type JobState = z.infer<typeof jobStateSchema>;

/** Success envelope shape produced by `apiEnvelopeSchema`. */
export interface ApiEnvelope<TData> {
  data: TData;
  meta?: Record<string, unknown>;
}
