import {
  blendTrendRelevance,
  computeTrendRelevance,
  hookSetSchema,
  rankTrends,
  rankTrendsByPopularity,
  singleHookResponseSchema,
  trendRemixRequestSchema,
  trendRemixSchema,
  trendRelevanceSchema,
  type CreatorDna,
  type Hook,
  type HookStyle,
  type RankedTrend,
  type Trend,
  type TrendListResponse,
  type TrendRemix,
  type TrendRemixRequest,
  type TrendRelevance,
} from '@creatordna/shared';
import {
  formatCountInstruction,
  formatIdeaBlock,
  formatTrendBlock,
  formatTrendsBlock,
  prompts,
} from '@creatordna/prompts';
import type { Logger } from 'pino';
import { NotFoundError } from '../lib/errors.js';
import type { Cache } from '../lib/cache.js';
import { remixCacheKey, trendRankingCacheKey } from '../lib/cache.js';
import type { TrendRepository } from '../lib/trendRepository.js';
import type { DnaService } from './dna.service.js';
import type { TextModelService } from './ai/index.js';

/**
 * Trend Remix + Hook Lab.
 *
 * Every call loads the creator's DNA first and injects it into the prompt, so a
 * request without a stored profile fails with a clear 404 instead of producing
 * generic output that merely looks personal.
 */

export interface TrendServiceDeps {
  repository: TrendRepository;
  dna: DnaService;
  ai: TextModelService;
  cache: Cache;
  logger: Logger;
  /** How long a per-user trend ranking stays fresh. Default 1 hour. */
  rankingTtlMs?: number;
  /** How long a remix/hook set stays fresh. Default 30 minutes. */
  generationTtlMs?: number;
  /** How much of the blended score the model owns. Default 0.5. */
  modelWeight?: number;
}

export interface TrendService {
  /** Ranked catalogue for one creator. */
  listForMe(uid: string): Promise<TrendListResponse>;
  /** One trend remixed for one creator. */
  remix(uid: string, request: TrendRemixRequest): Promise<TrendRemix>;
  /** 5-8 hooks in distinct styles, or exactly one when `regenerateStyle` is set. */
  hooks(
    uid: string,
    request: { idea: string; trendId?: string; count: number; regenerateStyle?: HookStyle },
  ): Promise<Hook[]>;
  /** Idempotent catalogue seeding (also exposed as a script). */
  seed(): Promise<number>;
}

const DEFAULT_RANKING_TTL_MS = 60 * 60 * 1000; // 1 hour, per the brief
const DEFAULT_GENERATION_TTL_MS = 30 * 60 * 1000;

/** The DNA fields every Phase 4 prompt needs, as prompt variables. */
function dnaVariables(dna: CreatorDna): Record<string, string> {
  return {
    dna_niche: dna.niche,
    dna_tone: dna.tone.join(', '),
    dna_audience: dna.audience.join(', '),
    dna_audience_age: dna.audienceAgeRange ?? 'unknown',
    dna_audience_type: dna.audienceType ?? 'unknown',
    dna_style: dna.style,
    dna_personality: dna.personality.join(', '),
    dna_format: dna.format,
    dna_vocabulary: dna.vocabulary.length > 0 ? dna.vocabulary.join(', ') : 'none recorded',
    dna_catchphrases: dna.catchphrases.length > 0 ? dna.catchphrases.join(', ') : 'none recorded',
  };
}

/**
 * Relevance judging ignores habits, and the template's interpolation is strict:
 * an unused variable throws. So the habit fields are only added for the prompts
 * that actually declare them.
 */
function dnaVariablesWithHabits(dna: CreatorDna): Record<string, string> {
  return {
    ...dnaVariables(dna),
    dna_dos: dna.dos.length > 0 ? dna.dos.join(', ') : 'none recorded',
    dna_donts: dna.donts.length > 0 ? dna.donts.join(', ') : 'none recorded',
  };
}

/** `id`-keyed map, so a missing model score is a miss rather than a crash. */
function scoreMap(scores: TrendRelevance['scores']): Map<string, number> {
  return new Map(scores.map((score) => [score.trendId, score.relevance]));
}

function reasonMap(scores: TrendRelevance['scores']): Map<string, string[]> {
  return new Map(scores.map((score) => [score.trendId, score.reasons]));
}

export function createTrendService(deps: TrendServiceDeps): TrendService {
  const rankingTtlMs = deps.rankingTtlMs ?? DEFAULT_RANKING_TTL_MS;
  const generationTtlMs = deps.generationTtlMs ?? DEFAULT_GENERATION_TTL_MS;
  const modelWeight = deps.modelWeight ?? 0.5;
  const { repository, dna, ai, cache, logger } = deps;

  /** Loads the profile or fails with a 404 the UI already understands. */
  async function requireDna(uid: string): Promise<CreatorDna> {
    try {
      const profile = await dna.getProfile(uid);
      return profile.dna;
    } catch (error) {
      logger.debug({ uid, err: error }, 'trend request without a DNA profile');
      throw new NotFoundError(
        'No Creator DNA yet - finish onboarding first, then trends can be matched to you.',
      );
    }
  }

  return {
    async listForMe(uid) {
      const key = trendRankingCacheKey(uid);
      const cached = await cache.get<{ trends: RankedTrend[]; personalizationLimited: boolean }>(key);
      if (cached !== undefined) {
        logger.debug({ uid, cached: cached.trends.length }, 'trend ranking served from cache');
        return {
          trends: cached.trends.map((entry) => ({ ...entry, cached: true })),
          personalizationLimited: cached.personalizationLimited,
        };
      }

      const catalogue = await repository.list();
      const profile = await dna.getProfile(uid).catch(() => null);

      let ranked: RankedTrend[];
      let personalizationLimited = false;

      if (profile === null) {
        // No DNA yet: popularity order, clearly flagged so the UI can say so.
        personalizationLimited = true;
        ranked = rankTrendsByPopularity(catalogue).map((entry) => ({
          ...entry,
          cached: false,
        }));
      } else {
        const heuristic = rankTrends(profile.dna, catalogue);

        // The model refines the order; the heuristic keeps it sane if it fails.
        const template = prompts.get('trend-relevance');
        let scores: TrendRelevance | undefined;
        try {
          const result = await ai.callJson<TrendRelevance>(
            prompts.render('trend-relevance', {
              ...dnaVariables(profile.dna),
              trends_block: formatTrendsBlock(catalogue),
            }),
            {
              schema: trendRelevanceSchema,
              promptId: template.id,
              promptVersion: template.version,
              uid,
              operation: 'trend-relevance',
              repromptHint:
                'Remember: score EVERY trend you were given, exactly once each, and keep relevance inside 0-100.',
            },
          );
          scores = result.data;
        } catch (error) {
          logger.warn(
            { uid, err: error },
            'trend relevance model call failed - falling back to the heuristic ranking',
          );
        }

        const blended = scores === undefined ? undefined : scoreMap(scores.scores);
        const reasons = scores === undefined ? undefined : reasonMap(scores.scores);

        ranked = heuristic
          .map((entry) => ({
            trend: entry.trend,
            relevance: blendTrendRelevance(
              entry.relevance,
              blended?.get(entry.trend.id),
              modelWeight,
            ),
            reasons:
              reasons?.get(entry.trend.id)?.filter((reason) => reason.trim().length > 0).slice(0, 3) ??
              entry.reasons,
            cached: false,
          }))
          .sort((a, b) => b.relevance - a.relevance);
      }

      await cache.set(key, { trends: ranked, personalizationLimited }, rankingTtlMs);

      logger.info(
        { uid, trends: ranked.length, personalizationLimited },
        'trend ranking computed',
      );

      return { trends: ranked, personalizationLimited };
    },

    async remix(uid, request) {
      const validated = trendRemixRequestSchema.parse(request);
      const profile = await requireDna(uid);

      let trend: Trend | null = null;
      if (validated.trendId !== undefined) {
        trend = await repository.get(validated.trendId);
        if (trend === null) {
          throw new NotFoundError(`No trend with id "${validated.trendId}".`);
        }
      }

      // Free-text ideas are cached too, keyed on the idea, so a double submit
      // costs one model call rather than two.
      const target = trend?.id ?? `idea:${(validated.idea ?? '').trim().toLowerCase()}`;
      const cacheKey = remixCacheKey(uid, target);
      const cachedRemix = await cache.get<TrendRemix>(cacheKey);
      if (cachedRemix !== undefined) {
        logger.debug({ uid, target }, 'remix served from cache');
        return cachedRemix;
      }

      const template = prompts.get('trend-remix');
      const messages = prompts.render('trend-remix', {
        ...dnaVariablesWithHabits(profile),
        trend_format: trend?.format ?? 'Free-form idea - no trend structure to preserve.',
        trend_title: trend?.title ?? 'Creator-supplied idea',
        trend_description:
          trend?.description ?? 'The creator brought their own idea rather than a trend.',
        trend_category: trend?.category ?? 'other',
        idea_block: formatIdeaBlock(validated.idea),
      });

      logger.info(
        { uid, trendId: trend?.id ?? null, promptId: template.id, promptVersion: template.version },
        'remix started',
      );

      const result = await ai.callJson<TrendRemix>(messages, {
        schema: trendRemixSchema,
        promptId: template.id,
        promptVersion: template.version,
        uid,
        operation: 'trend-remix',
        repromptHint:
          'Remember: keep the trend format, swap the topic/examples/CTA, and always fill whatWasKept and whatWasChanged.',
      });

      // The trend id is ours, never the model's: it is a foreign key.
      const remix = trendRemixSchema.parse({
        ...result.data,
        trendId: trend?.id ?? null,
        format: trend?.format ?? result.data.format,
      });

      await cache.set(cacheKey, remix, generationTtlMs);

      logger.info(
        {
          uid,
          trendId: remix.trendId,
          beats: remix.script.length,
          reprompted: result.reprompted,
          totalTokens: result.usage.totalTokens,
        },
        'remix complete',
      );

      return remix;
    },

    async hooks(uid, request) {
      const profile = await requireDna(uid);
      const trend =
        request.trendId === undefined ? null : await repository.get(request.trendId);
      if (request.trendId !== undefined && trend === null) {
        throw new NotFoundError(`No trend with id "${request.trendId}".`);
      }

      const template = prompts.get('hook-lab');
      const single = request.regenerateStyle !== undefined;
      const messages = prompts.render('hook-lab', {
        idea: request.idea,
        ...dnaVariablesWithHabits(profile),
        trend_block: formatTrendBlock(
          trend === null ? undefined : { title: trend.title, format: trend.format },
        ),
        count_instruction: formatCountInstruction(request.count, request.regenerateStyle),
      });

      logger.info(
        {
          uid,
          trendId: trend?.id ?? null,
          promptId: template.id,
          count: single ? 1 : request.count,
          regenerateStyle: request.regenerateStyle ?? null,
        },
        'hook lab started',
      );

      const result = await ai.callJson<{ hooks: Hook[] }>(messages, {
        // A single-style regeneration answers with one hook, not a set.
        schema: single ? singleHookResponseSchema : hookSetSchema,
        promptId: template.id,
        promptVersion: template.version,
        uid,
        operation: 'hook-lab',
        repromptHint: single
          ? `Remember: exactly ONE hook, and it must use the "${request.regenerateStyle}" style.`
          : 'Remember: every hook must use a DIFFERENT style, and the count must match exactly.',
      });

      const hooks = single
        ? singleHookResponseSchema.parse(result.data).hooks
        : hookSetSchema.parse(result.data).hooks;

      logger.info(
        {
          uid,
          count: hooks.length,
          styles: [...new Set(hooks.map((hook) => hook.style))],
          reprompted: result.reprompted,
          totalTokens: result.usage.totalTokens,
        },
        'hook lab complete',
      );

      return hooks;
    },

    async seed() {
      const written = await repository.seed();
      if (written > 0) {
        logger.info({ written }, 'trend catalogue seeded');
      }
      return written;
    },
  };
}

/** Re-exported so the controller and tests share one definition. */
export { computeTrendRelevance };

/** A style the UI can offer as a "regenerate just this one" button. */
export const REGENERABLE_STYLES: readonly HookStyle[] = [
  'question',
  'bold-claim',
  'pov',
  'story',
  'contrarian',
  'curiosity-gap',
];
