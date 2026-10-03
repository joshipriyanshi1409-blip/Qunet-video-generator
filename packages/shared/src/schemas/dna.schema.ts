import { z } from 'zod';
import {
  idSchema,
  isoDateTimeSchema,
  longTextSchema,
  shortTextSchema,
  tagListSchema,
  tagSchema,
} from './common.schema.js';

/** Audience segment label. Free-form on purpose - creators name their own audience. */
export const audienceSegmentSchema = z.string().trim().min(1).max(60);

/** How the creator's videos are usually shot. */
export const contentFormatSchema = z.enum([
  'talking-head',
  'b-roll-voiceover',
  'screen-recording',
  'whiteboard',
  'listicle',
  'storytime',
  'tutorial',
  'other',
]);

/**
 * Onboarding asks for an age *band*, not a birthday: creators think in bands and
 * the extraction prompt works better with a closed set.
 */
export const audienceAgeRangeSchema = z.enum(['13-17', '18-24', '25-34', '35-44', '45-54', '55+']);

/** Who the audience is, relative to the creator. */
export const audienceTypeSchema = z.enum([
  'beginners',
  'peers',
  'professionals',
  'hobbyists',
  'founders',
  'students',
  'parents',
  'other',
]);

export const samplePostSchema = z.object({
  text: longTextSchema,
  url: z.string().url().optional(),
});

const creatorDnaBaseSchema = z.object({
  niche: shortTextSchema,
  tone: z.array(tagSchema).min(1).max(6),
  audience: z.array(audienceSegmentSchema).min(1).max(8),
  style: z.string().trim().min(1).max(600),
  personality: z.array(tagSchema).min(1).max(8),
  format: contentFormatSchema,
  vocabulary: tagListSchema.default([]),
  catchphrases: tagListSchema.default([]),
  dos: tagListSchema.default([]),
  donts: tagListSchema.default([]),
  samplePosts: z.array(samplePostSchema).max(10).default([]),
  /**
   * Audience bands/types captured during onboarding. Optional on write: the
   * extraction step fills them, and older documents simply omit them.
   */
  audienceAgeRange: audienceAgeRangeSchema.optional(),
  audienceType: audienceTypeSchema.optional(),
});

/** Write payload: everything optional except the required identity fields. */
export const creatorDnaUpsertSchema = creatorDnaBaseSchema.extend({
  dnaVersion: z.number().int().positive().optional(),
  updatedAt: isoDateTimeSchema.optional(),
});

/** Full stored document at `users/{uid}/dna/{docId}`. */
export const creatorDnaSchema = creatorDnaUpsertSchema.extend({
  audienceAgeRange: audienceAgeRangeSchema.default('25-34'),
  audienceType: audienceTypeSchema.default('other'),
  dnaVersion: z.number().int().positive().default(1),
});

/**
 * Step 1-4 of onboarding: what the creator answers by hand.
 * `samplePosts` is step 5 and is the only optional one.
 */
export const dnaOnboardingInputSchema = z
  .object({
    niche: shortTextSchema,
    audienceAgeRange: audienceAgeRangeSchema,
    audienceType: audienceTypeSchema,
    audienceDescription: shortTextSchema.optional(),
    tone: z.array(tagSchema).min(1).max(6),
    format: contentFormatSchema,
    samplePosts: z.array(samplePostSchema).max(10).default([]),
  })
  .strict();

/** Onboarding answers before a profile exists (all fields optional). */
export const creatorDnaOnboardingSchema = z
  .object({
    niche: shortTextSchema.optional(),
    tone: z.array(tagSchema).max(6).optional(),
    audience: z.array(audienceSegmentSchema).max(8).optional(),
    style: z.string().trim().max(600).optional(),
    personality: z.array(tagSchema).max(8).optional(),
    format: contentFormatSchema.optional(),
    vocabulary: tagListSchema.optional(),
    catchphrases: tagListSchema.optional(),
    dos: tagListSchema.optional(),
    donts: tagListSchema.optional(),
    samplePosts: z.array(samplePostSchema).max(10).optional(),
    audienceAgeRange: audienceAgeRangeSchema.optional(),
    audienceType: audienceTypeSchema.optional(),
    audienceDescription: shortTextSchema.optional(),
  })
  .strict();

/**
 * DNA sync score: how complete the profile is *and* how much the evidence
 * agrees with it. Both are 0-100 and are combined by `computeDnaSyncScore`.
 */
export const dnaSyncScoreSchema = z.object({
  completeness: z.number().min(0).max(100),
  consistency: z.number().min(0).max(100),
  score: z.number().min(0).max(100),
  missingFields: z.array(z.string().min(1)),
  inconsistencies: z.array(z.string().min(1)),
  dnaVersion: z.number().int().positive(),
});

/**
 * Summary shown on the "My DNA" screen as a completion ring.
 * Kept as the historical name; it now carries consistency too.
 */
export const dnaSyncSummarySchema = dnaSyncScoreSchema;

/** Token/cost accounting for one AI call, logged for every extraction. */
export const aiUsageSchema = z.object({
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  /** Model that actually produced the response (may be the fallback). */
  model: z.string().min(1),
  /** True when the fallback model had to be used. */
  usedFallback: z.boolean(),
  /** Milliseconds spent on the winning attempt. */
  durationMs: z.number().int().nonnegative(),
});

/** POST /dna/extract response. */
export const dnaExtractionResponseSchema = z.object({
  dna: creatorDnaSchema,
  score: dnaSyncScoreSchema,
  /** The compact block every future prompt is prefixed with. */
  context: z.string(),
  contextTokens: z.number().int().nonnegative(),
  /** Which prompt produced it (auditable). */
  promptId: z.string().min(1),
  promptVersion: z.number().int().positive(),
  /** True when the first model response failed validation and was re-prompted. */
  reprompted: z.boolean(),
  usage: aiUsageSchema,
});

/** GET /dna response (404 before onboarding). */
export const dnaProfileResponseSchema = z.object({
  dna: creatorDnaSchema,
  score: dnaSyncScoreSchema,
  context: z.string(),
  contextTokens: z.number().int().nonnegative(),
});

/** PUT /dna request: a partial edit from the "Edit DNA" modal. */
export const dnaUpdateRequestSchema = creatorDnaBaseSchema.partial().extend({
  samplePosts: z.array(samplePostSchema).max(10).optional(),
});

/** One recent generation, used to keep the injected context current. */
export const dnaHistoryKindSchema = z.enum(['idea', 'script', 'render', 'feedback']);

export const dnaHistoryItemSchema = z.object({
  id: idSchema,
  kind: dnaHistoryKindSchema,
  createdAt: isoDateTimeSchema,
  summary: z.string().trim().min(1).max(400),
});

export const dnaHistoryAppendSchema = z
  .object({
    kind: dnaHistoryKindSchema,
    summary: z.string().trim().min(1).max(400),
  })
  .strict();

export type AudienceSegment = z.infer<typeof audienceSegmentSchema>;
export type AudienceAgeRange = z.infer<typeof audienceAgeRangeSchema>;
export type AudienceType = z.infer<typeof audienceTypeSchema>;
export type ContentFormat = z.infer<typeof contentFormatSchema>;
export type SamplePost = z.infer<typeof samplePostSchema>;
export type CreatorDnaUpsert = z.infer<typeof creatorDnaUpsertSchema>;
export type CreatorDna = z.infer<typeof creatorDnaSchema>;
export type CreatorDnaOnboarding = z.infer<typeof creatorDnaOnboardingSchema>;
export type DnaOnboardingInput = z.infer<typeof dnaOnboardingInputSchema>;
export type DnaSyncSummary = z.infer<typeof dnaSyncScoreSchema>;
export type DnaSyncScore = z.infer<typeof dnaSyncScoreSchema>;
export type AiUsage = z.infer<typeof aiUsageSchema>;
export type DnaExtractionResponse = z.infer<typeof dnaExtractionResponseSchema>;
export type DnaProfileResponse = z.infer<typeof dnaProfileResponseSchema>;
export type DnaUpdateRequest = z.infer<typeof dnaUpdateRequestSchema>;
export type DnaHistoryItem = z.infer<typeof dnaHistoryItemSchema>;
export type DnaHistoryKind = z.infer<typeof dnaHistoryKindSchema>;
