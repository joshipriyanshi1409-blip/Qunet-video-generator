import type { CreatorDna, CreatorDnaUpsert } from '../schemas/dna.schema.js';
import type { Trend, TrendCategory } from '../schemas/trend.schema.js';

/**
 * Deterministic trend -> DNA relevance scoring.
 *
 * `GET /trends/for-me` asks a model to rank the seeded trends for one creator,
 * but a ranking that only exists when a model answers is not a ranking: it is a
 * spinner. So every trend also gets a **heuristic** score computed here, from
 * the creator's own profile, with no network and no cost.
 *
 * The two are blended (`blendTrendRelevance`): the model supplies judgement the
 * rules cannot express, the heuristic anchors the result so a cold cache, a
 * timeout or a rate-limited creator still gets a sensible order. It is also what
 * makes the ranking testable - see `__tests__/trendEval.test.ts`.
 */

/** Words that carry no signal when comparing a niche to a trend. */
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'your', 'you', 'about',
  'into', 'over', 'just', 'like', 'more', 'most', 'than', 'then', 'very', 'can',
  'could', 'would', 'should', 'will', 'shall', 'may', 'might', 'must', 'have',
  'has', 'had', 'not', 'but', 'are', 'was', 'were', 'been', 'being', 'they',
  'them', 'their', 'there', 'here', 'what', 'when', 'where', 'which', 'while',
  'who', 'whom', 'why', 'how', 'all', 'any', 'both', 'each', 'few', 'other',
  'some', 'such', 'only', 'own', 'same', 'too', 'also', 'because', 'after',
  'before', 'between', 'during', 'above', 'below', 'off', 'out', 'again',
  'further', 'once', 'does', 'did', 'doing', 'get', 'got', 'make', 'made',
  'our', 'its', 'his', 'her', 'she', 'him', 'his',
]);

/** Lowercase word tokens, stopwords and very short words removed. */
export function tokenize(text: string): string[] {
  const seen = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 3 || STOPWORDS.has(raw)) continue;
    seen.add(raw);
  }
  return [...seen];
}

/**
 * Category vocabulary. A creator whose niche mentions these words is a natural
 * fit for a trend in that category; this is the cheapest, most reliable signal
 * there is and needs no model at all.
 */
const CATEGORY_KEYWORDS: Readonly<Record<TrendCategory, readonly string[]>> = {
  tech: [
    'tech', 'software', 'code', 'coding', 'developer', 'development',
    'programming', 'programmer', 'saas', 'api', 'data', 'database', 'cyber',
    'security', 'cloud', 'devops', 'linux', 'open', 'source', 'hardware',
    'chip', 'robot', 'automation', 'script',
  ],
  finance: [
    'finance', 'financial', 'money', 'investing', 'investment', 'invest',
    'stocks', 'stock', 'crypto', 'bitcoin', 'budget', 'budgeting', 'trading',
    'trade', 'fintech', 'tax', 'taxes', 'savings', 'debt', 'income', 'wealth',
    'economy', 'economics', 'pricing', 'revenue', 'profit', 'cash',
  ],
  fitness: [
    'fitness', 'gym', 'workout', 'workouts', 'strength', 'lifting', 'running',
    'runner', 'cardio', 'mobility', 'stretching', 'nutrition', 'protein',
    'health', 'training', 'athlete', 'marathon', 'yoga', 'pilates', 'sleep',
  ],
  food: [
    'food', 'cooking', 'cook', 'recipe', 'recipes', 'baking', 'bake', 'kitchen',
    'meal', 'meals', 'prep', 'chef', 'restaurant', 'eating', 'eat', 'diet',
    'vegan', 'coffee', 'bread', 'grill',
  ],
  education: [
    'learn', 'learning', 'teaching', 'teach', 'study', 'studying', 'exam',
    'exams', 'course', 'courses', 'tutorial', 'tutorials', 'education',
    'school', 'college', 'university', 'interview', 'interviews', 'dsa',
    'algorithm', 'algorithms', 'math', 'mathematics', 'science', 'physics',
    'chemistry', 'biology', 'history', 'language', 'languages', 'english',
    'grammar', 'vocabulary', 'reading', 'writing', 'revision', 'notes',
    'degree', 'certification', 'bootcamp',
  ],
  entertainment: [
    'movie', 'movies', 'film', 'films', 'cinema', 'show', 'shows', 'series',
    'gaming', 'game', 'games', 'gamer', 'celebrity', 'celebrities', 'music',
    'comedy', 'anime', 'manga', 'podcast', 'reviews', 'review', 'retro',
    'nostalgia', 'trailer', 'netflix', 'youtube', 'twitch',
  ],
  business: [
    'business', 'startup', 'startups', 'founder', 'founders', 'entrepreneur',
    'entrepreneurship', 'marketing', 'sales', 'selling', 'brand', 'branding',
    'ecommerce', 'agency', 'freelance', 'freelancer', 'consulting', 'hiring',
    'management', 'leadership', 'product', 'growth', 'customer', 'customers',
    'client', 'clients', 'copywriting', 'seo', 'ads', 'advertising',
  ],
  lifestyle: [
    'lifestyle', 'travel', 'travelling', 'fashion', 'style', 'beauty', 'home',
    'decor', 'declutter', 'productivity', 'habits', 'habit', 'mindset',
    'wellness', 'wellbeing', 'parenting', 'mom', 'dad', 'family', 'money',
    'minimalism', 'journal', 'journaling', 'morning', 'routine', 'routines',
  ],
  other: [],
};

/**
 * How much each signal contributes to the final score. Sums to 1.
 *
 * Lexical niche overlap is the strongest signal *when the trend's wording
 * happens to mention the niche* - but a trend's title describes its format, not
 * its topic, so it usually does not. The category therefore carries at least as
 * much weight: it is the bridge between "DSA interview prep" and a trend that
 * never says either word.
 */
const WEIGHTS = {
  nicheOverlap: 0.2,
  categoryAffinity: 0.35,
  formatAffinity: 0.15,
  audienceAffinity: 0.15,
  voiceAffinity: 0.15,
} as const;

/** Every signal, in 0..1, with the evidence that produced it. */
export interface TrendRelevanceSignals {
  nicheOverlap: number;
  categoryAffinity: number;
  formatAffinity: number;
  audienceAffinity: number;
  voiceAffinity: number;
}

export interface TrendRelevanceResult {
  /** 0-100. */
  relevance: number;
  signals: TrendRelevanceSignals;
  /** Human explanations, strongest first (max 3). */
  reasons: string[];
}

function countHits(needles: readonly string[], haystack: readonly string[]): number {
  const bag = new Set(haystack);
  let hits = 0;
  for (const needle of needles) {
    if (bag.has(needle)) hits += 1;
  }
  return hits;
}

/** Fraction of the creator's niche words that appear in the trend's text. */
function nicheOverlap(nicheTokens: readonly string[], trendTokens: readonly string[]): number {
  if (nicheTokens.length === 0) return 0;
  const hits = countHits(nicheTokens, trendTokens);
  return Math.min(1, hits / nicheTokens.length);
}

/** Does the creator's niche live in this trend's category? */
function categoryAffinity(
  category: TrendCategory,
  nicheText: string,
  nicheTokens: readonly string[],
): number {
  const keywords = CATEGORY_KEYWORDS[category];
  if (keywords.length === 0) return 0.3; // "other": no evidence either way
  const hits = countHits(keywords, nicheTokens);
  if (hits > 0) return Math.min(1, hits / 2);
  // Fall back to a substring check so "interview prep" matches "interview".
  const lowered = nicheText.toLowerCase();
  return keywords.some((keyword) => lowered.includes(keyword)) ? 0.5 : 0;
}

/**
 * Formats are transferable - a talking-head creator can absolutely shoot a
 * whiteboard trend - so "no evidence" sits just above the midpoint and a real
 * match is the only thing that reaches 1.
 */
function formatAffinity(dnaFormat: string, trendText: string): number {
  const normalized = dnaFormat.trim().toLowerCase();
  if (normalized.length === 0 || normalized === 'other') return 0.5;
  const human = normalized.replace(/-/g, ' ');
  if (trendText.includes(normalized) || trendText.includes(human)) return 1;
  return 0.45;
}

function audienceAffinity(dna: CreatorDnaUpsert, trendText: string): number {
  const mentions = [...dna.audience, dna.audienceType ?? '']
    .filter((value) => value.trim().length > 0)
    .map((value) => value.trim().toLowerCase());
  const hits = mentions.filter((mention) => trendText.includes(mention)).length;
  if (hits === 0) return 0.35;
  return Math.min(1, 0.5 + hits * 0.25);
}

function voiceAffinity(dna: CreatorDnaUpsert, trendTokens: readonly string[]): number {
  const words = [...(dna.vocabulary ?? []), ...(dna.catchphrases ?? [])]
    .flatMap((entry) => tokenize(entry))
    .filter((word) => word.length >= 4);
  // A creator with no recorded vocabulary, or a trend that simply does not
  // happen to reuse it, is "no evidence" - not evidence against.
  if (words.length === 0) return 0.35;
  const hits = countHits(words, trendTokens);
  if (hits === 0) return 0.35;
  return Math.min(1, hits / 3);
}

function round(value: number): number {
  return Math.round(value);
}

/**
 * Scores one trend against one creator, with no model call.
 *
 * Deterministic and cheap: it runs on every request, so it is also the fallback
 * when the model is unavailable and the anchor for the blended score.
 */
export function computeTrendRelevance(dna: CreatorDnaUpsert, trend: Trend): TrendRelevanceResult {
  const trendText = `${trend.title} ${trend.format} ${trend.description}`.toLowerCase();
  const nicheTokens = tokenize(dna.niche);
  const trendTokens = tokenize(trendText);

  const signals: TrendRelevanceSignals = {
    nicheOverlap: nicheOverlap(nicheTokens, trendTokens),
    categoryAffinity: categoryAffinity(trend.category, dna.niche, nicheTokens),
    formatAffinity: formatAffinity(dna.format, trendText),
    audienceAffinity: audienceAffinity(dna, trendText),
    voiceAffinity: voiceAffinity(dna, trendTokens),
  };

  const weighted =
    signals.nicheOverlap * WEIGHTS.nicheOverlap +
    signals.categoryAffinity * WEIGHTS.categoryAffinity +
    signals.formatAffinity * WEIGHTS.formatAffinity +
    signals.audienceAffinity * WEIGHTS.audienceAffinity +
    signals.voiceAffinity * WEIGHTS.voiceAffinity;

  // A tiny nudge for popularity so that, all else equal, the trend more people
  // are already making wins the tie.
  const popularity = (trend.popularityScore ?? 50) / 100;
  const blended = Math.min(1, Math.max(0, weighted * 0.94 + popularity * 0.06));

  const labelled: { label: string; value: number }[] = [
    { label: `matches your niche (${dna.niche})`, value: signals.nicheOverlap },
    { label: `sits in ${trend.category}, where your audience already is`, value: signals.categoryAffinity },
    { label: `fits your ${dna.format.replace(/-/g, ' ')} format`, value: signals.formatAffinity },
    { label: 'speaks to your audience segments', value: signals.audienceAffinity },
    { label: 'reuses your own vocabulary', value: signals.voiceAffinity },
  ];

  const reasons = labelled
    .filter((entry) => entry.value >= 0.5)
    .sort((a, b) => b.value - a.value)
    .slice(0, 3)
    .map((entry) => entry.label);

  return { relevance: round(blended * 100), signals, reasons };
}

/** All trends, scored, best first. Ties broken by popularity then id. */
export function rankTrends(
  dna: CreatorDnaUpsert,
  trends: readonly Trend[],
): { trend: Trend; relevance: number; reasons: string[] }[] {
  return trends
    .map((trend) => {
      const result = computeTrendRelevance(dna, trend);
      return { trend, relevance: result.relevance, reasons: result.reasons };
    })
    .sort(
      (a, b) =>
        b.relevance - a.relevance ||
        (b.trend.popularityScore ?? 0) - (a.trend.popularityScore ?? 0) ||
        a.trend.id.localeCompare(b.trend.id),
    );
}

/**
 * Merges the model's score with the heuristic one.
 *
 * The heuristic keeps the ranking sane when the cache is cold or the model is
 * degraded; the model can still move a trend by up to `modelWeight` of the
 * range. Returns the heuristic score untouched when `modelScore` is missing.
 */
export function blendTrendRelevance(
  heuristic: number,
  modelScore: number | undefined,
  modelWeight = 0.5,
): number {
  // A missing or non-finite score means "the model told us nothing", so the
  // heuristic stands on its own rather than being dragged toward zero.
  if (modelScore === undefined || !Number.isFinite(modelScore)) return clamp(heuristic);
  const weight = Math.min(1, Math.max(0, modelWeight));
  // A model can be confidently wrong or simply broken: clamp both inputs so a
  // nonsense score can never push a ranking outside 0-100.
  const safeHeuristic = clamp(heuristic);
  const safeModel = clamp(modelScore);
  return round(safeHeuristic * (1 - weight) + safeModel * weight);
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

/** Popularity-only ordering, used before a creator has any DNA. */
export function rankTrendsByPopularity(
  trends: readonly Trend[],
): { trend: Trend; relevance: number; reasons: string[] }[] {
  return trends
    .map((trend) => ({
      trend,
      relevance: trend.popularityScore ?? 50,
      reasons: ['trending right now'],
    }))
    .sort(
      (a, b) =>
        b.relevance - a.relevance || a.trend.id.localeCompare(b.trend.id),
    );
}

/** Convenience: the DNA fields a relevance call needs. */
export type RelevanceDna = CreatorDna | CreatorDnaUpsert;
