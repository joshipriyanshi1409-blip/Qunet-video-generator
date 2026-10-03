import { z } from 'zod';
import { idSchema } from './common.schema.js';

/**
 * Hook styles. Hook Lab always returns a *spread* of these - five hooks in the
 * same style would be useless - so the model is asked for distinct styles and
 * the service verifies it.
 */
export const hookStyleSchema = z.enum([
  'question',
  'bold-claim',
  'pov',
  'story',
  'contrarian',
  'curiosity-gap',
]);

/** Human labels, shared by the API logs and the UI tags. */
export const HOOK_STYLE_LABELS: Readonly<Record<z.infer<typeof hookStyleSchema>, string>> = {
  question: 'Question',
  'bold-claim': 'Bold claim',
  pov: 'POV',
  story: 'Story',
  contrarian: 'Contrarian',
  'curiosity-gap': 'Curiosity gap',
};

export const hookSchema = z.object({
  id: idSchema,
  text: z.string().trim().min(1).max(300),
  style: hookStyleSchema,
  whyItWorks: z.string().trim().min(1).max(300),
});

/** Hook Lab always returns 5-8 hooks. */
export const hookSetSchema = z.object({
  hooks: z.array(hookSchema).min(5).max(8),
});

/**
 * Exactly one hook, wrapped like a set so "regenerate just this style" reuses
 * the same prompt and the same response shape.
 */
export const singleHookResponseSchema = z.object({
  hooks: z.array(hookSchema).length(1),
});

/**
 * What Hook Lab returns: a whole set, or exactly one hook when the creator asked
 * to regenerate a single style. The UI validates both through this schema.
 */
export const hookResponseSchema = z.object({
  hooks: z.array(hookSchema).min(1).max(8),
});

/**
 * Request body for Hook Lab.
 *
 * `idea` is required (a hook needs something to hook onto); `trendId` is
 * optional context when the creator arrived from a trend.
 */
export const hookLabRequestSchema = z.object({
  idea: z.string().trim().min(1).max(2000),
  trendId: idSchema.optional(),
  count: z.number().int().min(5).max(8).default(6),
  /** Regenerate a single hook by style instead of the whole set. */
  regenerateStyle: hookStyleSchema.optional(),
});

/** Optional fields a creator can hand-edit on a hook before saving it. */
export const hookEditSchema = z.object({
  text: z.string().trim().min(1).max(300),
});

export type HookStyle = z.infer<typeof hookStyleSchema>;
export type Hook = z.infer<typeof hookSchema>;
export type HookSet = z.infer<typeof hookSetSchema>;
export type SingleHookResponse = z.infer<typeof singleHookResponseSchema>;
export type HookResponse = z.infer<typeof hookResponseSchema>;
export type HookLabRequest = z.infer<typeof hookLabRequestSchema>;
