import { z } from 'zod';
import {
  idSchema,
  isoDateTimeSchema,
  longTextSchema,
  shortTextSchema,
  tagSchema,
} from './common.schema.js';
import { audienceSegmentSchema } from './dna.schema.js';

export const trendCategorySchema = z.enum([
  'tech',
  'finance',
  'fitness',
  'food',
  'education',
  'entertainment',
  'business',
  'lifestyle',
  'other',
]);

/**
 * A trending format at `trends/{id}`.
 *
 * `format` is the recognizable skeleton ("POV: you finally {achievement}") that
 * a remix must preserve; `title` and `description` describe one instance of it.
 */
export const trendSchema = z.object({
  id: idSchema,
  /** Short human title, e.g. "POV: You finally understand ...". */
  title: shortTextSchema,
  /** The recognizable structure that must survive the remix. */
  format: shortTextSchema,
  description: longTextSchema,
  category: trendCategorySchema,
  thumbnailUrl: z.string().url().optional(),
  sourceUrl: z.string().url().optional(),
  popularityScore: z.number().min(0).max(100).optional(),
  createdAt: isoDateTimeSchema.optional(),
});

/**
 * Request body for "remix this to fit my DNA".
 *
 * Exactly one of `trendId` / `idea` is required: a known trend keeps its
 * structure, a free-text idea starts from the creator's own thought.
 */
export const trendRemixRequestSchema = z
  .object({
    trendId: idSchema.optional(),
    idea: longTextSchema.optional(),
    /** Optional: replace the DNA's audience segments for this remix only. */
    audienceOverride: z.array(audienceSegmentSchema).max(8).optional(),
  })
  .refine((value) => value.trendId !== undefined || value.idea !== undefined, {
    message: 'Provide a trendId or a free-text idea.',
    path: ['trendId'],
  });

/** One scene of the remixed script. `scene` is the beat label, not a shot list. */
export const trendRemixSceneSchema = z.object({
  scene: shortTextSchema,
  text: longTextSchema,
});

/**
 * The remix result: the same recognizable structure as the trend, but the
 * topic, examples and CTA belong to the creator.
 *
 * `whatWasKept` / `whatWasChanged` are not decoration: they are the audit trail
 * that makes "keep the structure, swap the topic" verifiable by a human and by
 * the eval fixtures.
 */
export const trendRemixSchema = z.object({
  /** `null` when the remix came from a free-text idea rather than a trend. */
  trendId: idSchema.nullable().default(null),
  /** The format skeleton that was preserved. */
  format: shortTextSchema,
  hook: z.string().trim().min(1).max(300),
  script: z.array(trendRemixSceneSchema).min(1).max(12),
  cta: z.string().trim().min(1).max(300),
  caption: z.string().trim().min(1).max(600),
  hashtags: z.array(tagSchema).max(12).default([]),
  whatWasKept: z.array(shortTextSchema).min(1).max(8),
  whatWasChanged: z.array(shortTextSchema).min(1).max(8),
});

/** A trend plus how well it fits one creator. */
export const rankedTrendSchema = z.object({
  trend: trendSchema,
  /** 0-100, from `computeTrendRelevance` (see `lib/trendRelevance.ts`). */
  relevance: z.number().min(0).max(100),
  /** Short human reasons, shown as tooltips/badges in the UI. */
  reasons: z.array(shortTextSchema).max(4).default([]),
  /** True when the ranking came from the per-user cache. */
  cached: z.boolean().default(false),
});

/** `GET /trends/for-me` response. */
export const trendListResponseSchema = z.object({
  trends: z.array(rankedTrendSchema),
  /** True when the creator has no DNA yet, so the ranking is unpersonalised. */
  personalizationLimited: z.boolean().default(false),
});

/** Request body for the trend ranking model call. */
export const trendRelevanceRequestSchema = z.object({
  trends: z.array(trendSchema).min(1).max(50),
});

/** One model-scored trend. */
export const trendRelevanceScoreSchema = z.object({
  trendId: idSchema,
  relevance: z.number().min(0).max(100),
  reasons: z.array(shortTextSchema).max(4).default([]),
});

/** The model's answer for `trend-relevance` v1. */
export const trendRelevanceSchema = z.object({
  scores: z.array(trendRelevanceScoreSchema).min(1).max(50),
});

export type TrendCategory = z.infer<typeof trendCategorySchema>;
export type Trend = z.infer<typeof trendSchema>;
export type TrendRemixRequest = z.infer<typeof trendRemixRequestSchema>;
export type TrendRemixScene = z.infer<typeof trendRemixSceneSchema>;
export type TrendRemix = z.infer<typeof trendRemixSchema>;
export type RankedTrend = z.infer<typeof rankedTrendSchema>;
export type TrendListResponse = z.infer<typeof trendListResponseSchema>;
export type TrendRelevance = z.infer<typeof trendRelevanceSchema>;
export type TrendRelevanceScore = z.infer<typeof trendRelevanceScoreSchema>;
