import { z } from 'zod';
import { idSchema, isoDateTimeSchema } from './common.schema.js';
import { creatorDnaSchema } from './dna.schema.js';

/**
 * The learning loop's data model.
 *
 * Three things live here and they are deliberately separate:
 *
 * - a **signal** is something the creator *did*. It is evidence, it is never
 *   interpreted by the app, and it is never deleted when a suggestion is
 *   resolved - the audit trail has to outlive the suggestion.
 * - a **suggestion** is what a model *proposed* from those signals. It is inert
 *   until a human accepts it. Nothing in this file, or the service that uses it,
 *   writes to the DNA on the strength of a suggestion alone.
 * - a **version snapshot** is the DNA as it stood at one `dnaVersion`, so the
 *   history page can show what actually changed rather than a counter.
 */

/** The four behaviours the studio learns from. */
export const dnaSignalKindSchema = z.enum([
  'hook_chosen',
  'remix_approved',
  'remix_rejected',
  'audience_tip_applied',
]);
export type DnaSignalKind = z.infer<typeof dnaSignalKindSchema>;

/**
 * One recorded behaviour.
 *
 * `label` is the thing itself - the hook line, the remix text, the tip - because
 * a suggestion that cannot show its evidence is a suggestion nobody accepts.
 */
export const dnaSignalSchema = z.object({
  id: idSchema,
  kind: dnaSignalKindSchema,
  createdAt: isoDateTimeSchema,
  label: z.string().trim().min(1).max(400),
  /** Which screen it came from, so the history reads as a story. */
  source: z.string().trim().min(1).max(80),
});
export type DnaSignal = z.infer<typeof dnaSignalSchema>;

/** Write payload from the client. Strict: an unknown key is a bug, not a field. */
export const dnaSignalAppendSchema = z
  .object({
    kind: dnaSignalKindSchema,
    label: z.string().trim().min(1).max(400),
    source: z.string().trim().min(1).max(80),
  })
  .strict();
export type DnaSignalAppend = z.infer<typeof dnaSignalAppendSchema>;

/** DNA fields a suggestion is allowed to touch. */
export const DNA_SUGGESTION_FIELDS = [
  'vocabulary',
  'catchphrases',
  'tone',
  'personality',
  'dos',
  'donts',
  'audience',
  'style',
] as const;

export const dnaSuggestionFieldSchema = z.enum(DNA_SUGGESTION_FIELDS);
export type DnaSuggestionField = z.infer<typeof dnaSuggestionFieldSchema>;

/**
 * `add` appends to a list; `replace` overwrites it.
 *
 * The distinction matters for `tone` and `style`: "add these words" and "your
 * tone should read like this instead" are different operations, and collapsing
 * them into one would make an accepted suggestion either a no-op or a wipe.
 */
export const dnaSuggestionActionSchema = z.enum(['add', 'replace']);
export type DnaSuggestionAction = z.infer<typeof dnaSuggestionActionSchema>;

export const dnaSuggestionStatusSchema = z.enum(['pending', 'accepted', 'rejected']);
export type DnaSuggestionStatus = z.infer<typeof dnaSuggestionStatusSchema>;

export const dnaSuggestionSchema = z.object({
  id: idSchema,
  field: dnaSuggestionFieldSchema,
  action: dnaSuggestionActionSchema,
  status: dnaSuggestionStatusSchema,
  createdAt: isoDateTimeSchema,
  resolvedAt: isoDateTimeSchema.nullable().default(null),
  /** What would be written. 1-8 entries; see `DNA_FIELD_LIMITS`. */
  value: z.array(z.string().trim().min(1).max(120)).min(1).max(8),
  /** Why, in the creator's terms. Shown verbatim next to the accept button. */
  rationale: z.string().trim().min(1).max(400),
  /** Signal ids this was reasoned from. Empty means "from the profile alone". */
  evidence: z.array(idSchema).max(20).default([]),
  promptId: z.string().min(1),
  promptVersion: z.number().int().positive(),
  /** The model that actually produced it - may be the configured fallback. */
  model: z.string().min(1),
});
export type DnaSuggestion = z.infer<typeof dnaSuggestionSchema>;

/**
 * Ceiling per field, taken from `creatorDnaSchema` so an accepted suggestion can
 * never push a field past what the profile will validate. `style` is a single
 * string, so its limit is one entry.
 */
export const DNA_FIELD_LIMITS: Record<DnaSuggestionField, number> = {
  vocabulary: 40,
  catchphrases: 40,
  tone: 6,
  personality: 8,
  dos: 40,
  donts: 40,
  audience: 8,
  style: 1,
};

/** The DNA as it stood at one version. */
export const dnaVersionSnapshotSchema = z.object({
  version: z.number().int().positive(),
  savedAt: isoDateTimeSchema,
  /** What caused this version, e.g. "Accepted: add 2 vocabulary word(s)". */
  summary: z.string().trim().min(1).max(400),
  dna: creatorDnaSchema,
});
export type DnaVersionSnapshot = z.infer<typeof dnaVersionSnapshotSchema>;

/**
 * What the model returns: proposals only.
 *
 * The draft carries no id, no status and no timestamps - the service fills those
 * in, so a model can never mint its own ids or mark its own work accepted.
 */
export const dnaSuggestionDraftSchema = z.object({
  field: dnaSuggestionFieldSchema,
  action: dnaSuggestionActionSchema,
  value: z.array(z.string().trim().min(1).max(120)).min(1).max(8),
  rationale: z.string().trim().min(1).max(400),
  evidence: z.array(idSchema).max(20).default([]),
});
export type DnaSuggestionDraft = z.infer<typeof dnaSuggestionDraftSchema>;

/** The full LLM response for one learning run. */
export const dnaSuggestionSetSchema = z.object({
  suggestions: z.array(dnaSuggestionDraftSchema).min(1).max(8),
});
export type DnaSuggestionSet = z.infer<typeof dnaSuggestionSetSchema>;

/** GET /dna/signals */
export const dnaSignalsResponseSchema = z.object({
  signals: z.array(dnaSignalSchema),
});
export type DnaSignalsResponse = z.infer<typeof dnaSignalsResponseSchema>;

/** GET /dna/suggestions */
export const dnaSuggestionsResponseSchema = z.object({
  suggestions: z.array(dnaSuggestionSchema),
  /** True when the run was skipped because there was nothing new to learn from. */
  skipped: z.boolean().default(false),
});
export type DnaSuggestionsResponse = z.infer<typeof dnaSuggestionsResponseSchema>;

/** GET /dna/versions */
export const dnaVersionsResponseSchema = z.object({
  versions: z.array(dnaVersionSnapshotSchema),
  /** The live profile's version, so the page can mark "current". */
  currentVersion: z.number().int().positive(),
});
export type DnaVersionsResponse = z.infer<typeof dnaVersionsResponseSchema>;
