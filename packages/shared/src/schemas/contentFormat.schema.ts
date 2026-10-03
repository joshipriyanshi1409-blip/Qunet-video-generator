import { z } from 'zod';
import { COST_LIMITS } from '../constants/index.js';

/**
 * Content format recipes.
 *
 * Each format is a structured recipe that influences every stage of generation:
 * hook styles, pacing, visual treatment, caption styling, narration tone,
 * scene duration, CTA approach, and loop strategy.
 *
 * A format is NOT just a label — it is a configuration object that the AI
 * orchestrator feeds into every generation step.
 */

/** Content format categories for grouping. */
export const contentFormatCategorySchema = z.enum([
  'storytelling',
  'education',
  'entertainment',
  'lifestyle',
  'technology',
  'business',
  'creative',
  'wellness',
]);

/** Hook style types used across content formats. */
export const contentFormatHookStyleSchema = z.enum([
  'curiosity',
  'question',
  'shock',
  'contrarian',
  'story',
  'emotional',
  'statistic',
  'mystery',
  'promise',
  'challenge',
  'pov',
  'bold-claim',
  'listicle',
]);

export type FormatHookStyle = z.infer<typeof contentFormatHookStyleSchema>;

/** Pacing levels. */
export const pacingSchema = z.enum(['slow', 'moderate', 'fast', 'very-fast']);

/** Visual style descriptors. */
export const visualStyleSchema = z.enum([
  'cinematic',
  'minimal',
  'dynamic',
  'text-heavy',
  'b-roll',
  'ai-generated',
  'mixed-media',
  'screen-recording',
  'talking-head',
  'animation',
]);

/** Caption style descriptors. */
export const captionStyleSchema = z.enum([
  'word-by-word',
  'phrase',
  'full-line',
  'kinetic',
  'minimal',
  'bold-center',
  'subtitle',
]);

/** Narration style descriptors. */
export const narrationStyleSchema = z.enum([
  'conversational',
  'authoritative',
  'dramatic',
  'casual',
  'energetic',
  'deadpan',
  'storytelling',
  'educational',
  'whisper',
]);

/** CTA style descriptors. */
export const ctaStyleSchema = z.enum([
  'follow',
  'comment',
  'share',
  'save',
  'click-link',
  'subscribe',
  'loop',
  'series-tease',
  'soft-ask',
]);

/** Scene structure step. */
export const sceneStructureStepSchema = z.object({
  label: z.string().min(1).max(60),
  description: z.string().min(1).max(200),
  /** Relative weight for duration allocation. */
  weight: z.number().min(0.1).max(5),
});

/** A complete content format recipe. */
export const contentFormatRecipeSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().min(1).max(60),
  category: contentFormatCategorySchema,
  description: z.string().min(1).max(300),
  /** Recommended duration range in seconds. */
  recommendedDuration: z.object({
    min: z.number().min(COST_LIMITS.minDurationSeconds).max(COST_LIMITS.maxDurationSeconds),
    max: z.number().min(COST_LIMITS.minDurationSeconds).max(120),
    default: z.number().min(COST_LIMITS.minDurationSeconds).max(120),
  }),
  pacing: pacingSchema,
  hookStyles: z.array(contentFormatHookStyleSchema).min(1).max(5),
  /** Narrative structure: the ordered steps this format follows. */
  structure: z.array(sceneStructureStepSchema).min(2).max(12),
  visualStyle: visualStyleSchema,
  captionStyle: captionStyleSchema,
  narrationStyle: narrationStyleSchema,
  /** Default scene duration in seconds. */
  sceneDuration: z.object({
    min: z.number().min(1).max(15),
    max: z.number().min(2).max(30),
    default: z.number().min(2).max(20),
  }),
  ctaStyles: z.array(ctaStyleSchema).min(1).max(3),
  /** Whether this format benefits from a seamless loop ending. */
  loopStrategy: z.enum(['none', 'soft-loop', 'hard-loop']).default('none'),
  /** Music intensity: 0-1 scale. */
  musicIntensity: z.number().min(0).max(1).default(0.5),
  /** Transition style between scenes. */
  transitions: z.array(z.string().min(1).max(40)).max(5).default(['cut']),
  /** Audience trigger keywords that this format targets. */
  audienceTriggers: z.array(z.string().min(1).max(40)).max(8).default([]),
});

/** Format selection request from the user. */
export const formatSelectionSchema = z.object({
  mode: z.enum(['ai-recommended', 'manual']),
  formatId: z.string().min(1).max(40).optional(),
  /** When AI recommended, these are the top picks. */
  recommendations: z.array(z.object({
    formatId: z.string().min(1).max(40),
    score: z.number().min(0).max(100),
    reason: z.string().min(1).max(200),
  })).max(5).optional(),
});

/** Result of AI format recommendation. */
export const formatRecommendationSchema = z.object({
  recommendations: z.array(z.object({
    formatId: z.string(),
    formatName: z.string(),
    score: z.number().min(0).max(100),
    reason: z.string(),
  })).min(1).max(5),
  analysis: z.string().min(1).max(500),
});

export type ContentFormatCategory = z.infer<typeof contentFormatCategorySchema>;
export type Pacing = z.infer<typeof pacingSchema>;
export type VisualStyle = z.infer<typeof visualStyleSchema>;
export type CaptionStyle = z.infer<typeof captionStyleSchema>;
export type NarrationStyle = z.infer<typeof narrationStyleSchema>;
export type CtaStyle = z.infer<typeof ctaStyleSchema>;
export type SceneStructureStep = z.infer<typeof sceneStructureStepSchema>;
export type ContentFormatRecipe = z.infer<typeof contentFormatRecipeSchema>;
export type FormatSelection = z.infer<typeof formatSelectionSchema>;
export type FormatRecommendation = z.infer<typeof formatRecommendationSchema>;
