import { describe, expect, it } from 'vitest';
import {
  creatorDnaSchema,
  trendSchema,
  type CreatorDna,
  type Trend,
} from '../schemas/index.js';
import {
  blendTrendRelevance,
  computeTrendRelevance,
  rankTrends,
  rankTrendsByPopularity,
} from '../lib/trendRelevance.js';

/**
 * Phase 4 eval fixtures.
 *
 * Five creators, each with a distinct profile. The assertions are *trait*
 * checks, not golden strings: they encode what must stay true when the DNA
 * changes, which is the Phase 4 acceptance criterion
 * ("changing the DNA visibly changes the output").
 *
 * Kept in `shared` because `computeTrendRelevance` lives there and the point is
 * that the ranking is a pure function of the profile - no model, no network, no
 * clock.
 */

function makeDna(overrides: Partial<CreatorDna>): CreatorDna {
  return creatorDnaSchema.parse({
    niche: 'generic',
    tone: ['neutral'],
    audience: ['everyone'],
    style: 'Plain and factual.',
    personality: ['calm'],
    format: 'talking-head',
    vocabulary: [],
    catchphrases: [],
    dos: [],
    donts: [],
    samplePosts: [],
    audienceAgeRange: '25-34',
    audienceType: 'other',
    ...overrides,
  });
}

function makeTrend(overrides: Partial<Trend>): Trend {
  return trendSchema.parse({
    id: 'trend_test',
    title: 'A trend',
    format: 'Do the thing',
    description: 'A description of the trend.',
    category: 'other',
    popularityScore: 50,
    ...overrides,
  });
}

/** The five eval DNAs. */
export const EVAL_DNAS = {
  /** Career-switching engineer teaching data structures. */
  dsaCoach: makeDna({
    niche: 'DSA interview prep for career switchers',
    tone: ['direct', 'playful'],
    audience: ['professionals', 'students'],
    style: 'Short sentences, whiteboard, fast cuts',
    personality: ['blunt', 'encouraging'],
    format: 'whiteboard',
    vocabulary: ['amortized', 'invariant'],
    catchphrases: ['Binary search in 30 seconds'],
    dos: ['dry run the code'],
    donts: ['jargon dumps'],
    samplePosts: [{ text: 'Binary search in 30 seconds. Amortized analysis matters.' }],
    audienceAgeRange: '25-34',
    audienceType: 'professionals',
  }),

  /** Personal-finance creator for people in their first job. */
  moneyBasics: makeDna({
    niche: 'Personal finance for people in their first job',
    tone: ['warm', 'no-nonsense'],
    audience: ['beginners'],
    style: 'Calm, screen-recorded, one number per video',
    personality: ['patient', 'practical'],
    format: 'screen-recording',
    vocabulary: ['compound interest', 'emergency fund'],
    catchphrases: ['Pay yourself first'],
    dos: ['show the real spreadsheet'],
    donts: ['never shame a budget'],
    audienceAgeRange: '18-24',
    audienceType: 'beginners',
  }),

  /** Retro game reviewer with a dry voice. */
  retroGamer: makeDna({
    niche: 'Retro game reviews',
    tone: ['wry', 'calm'],
    audience: ['hobbyists'],
    style: 'Dry narration over gameplay, slow zooms',
    personality: ['sardonic', 'nerdy'],
    format: 'b-roll-voiceover',
    vocabulary: ['sprites', 'frame data'],
    catchphrases: ['Aged like a cartridge'],
    dos: ['name the year'],
    donts: ['never spoil the ending'],
    audienceAgeRange: '25-34',
    audienceType: 'hobbyists',
  }),

  /** Strength coach for people who hate the gym. */
  strengthCoach: makeDna({
    niche: 'Strength training for people who hate the gym',
    tone: ['encouraging', 'blunt'],
    audience: ['beginners', 'parents'],
    style: 'Talking head in a garage, chalk on the lens',
    personality: ['straight-talking', 'warm'],
    format: 'talking-head',
    vocabulary: ['progressive overload', 'deload'],
    catchphrases: ['Two hard sets, not ten lazy ones'],
    dos: ['show the failed rep'],
    donts: ['never sell a supplement'],
    audienceAgeRange: '35-44',
    audienceType: 'beginners',
  }),

  /** Bootstrapped SaaS founder sharing what he ships. */
  indieFounder: makeDna({
    niche: 'Bootstrapped SaaS founder sharing what he ships',
    tone: ['technical', 'storyteller'],
    audience: ['founders'],
    style: 'Screen recording, real dashboards, no hype',
    personality: ['candid', 'dry'],
    format: 'screen-recording',
    vocabulary: ['churn', 'activation'],
    catchphrases: ['Ship the ugly version'],
    dos: ['show the actual numbers'],
    donts: ['never promise a shortcut'],
    audienceAgeRange: '25-34',
    audienceType: 'founders',
  }),
} satisfies Record<string, CreatorDna>;

/** A small, representative slice of the seeded trend catalogue. */
export const EVAL_TRENDS: Trend[] = [
  makeTrend({
    id: 'trend_pov_finally',
    title: 'POV: you finally understand it',
    format: 'POV: you finally understand {concept} after {time}',
    description: 'Narrate the moment a concept clicks, then explain it in one line.',
    category: 'education',
    popularityScore: 91,
  }),
  makeTrend({
    id: 'trend_i_was_wrong',
    title: 'I was wrong about this for years',
    format: 'I was wrong about {common belief} for {duration}',
    description: 'Admit a mistake on camera, then correct it with one concrete example.',
    category: 'education',
    popularityScore: 74,
  }),
  makeTrend({
    id: 'trend_three_mistakes',
    title: 'Three mistakes keeping you broke',
    format: '{number} mistakes keeping you {outcome}',
    description: 'Count down the mistakes, one fix each, spreadsheet on screen.',
    category: 'finance',
    popularityScore: 68,
  }),
  makeTrend({
    id: 'trend_before_after',
    title: 'Day 1 vs day 365',
    format: 'Day {n} vs day {n*365}',
    description: 'Split-screen transformation with a voiceover of what changed.',
    category: 'fitness',
    popularityScore: 88,
  }),
  makeTrend({
    id: 'trend_aged_badly',
    title: 'This aged badly',
    format: 'This aged {badly|well}',
    description: 'Replay an old clip and grade it on screen with dry commentary.',
    category: 'entertainment',
    popularityScore: 79,
  }),
  makeTrend({
    id: 'trend_mrr_screenshot',
    title: 'My real MRR screenshot',
    format: 'My real {metric} screenshot',
    description: 'Show the dashboard unedited, then explain the one number that moved.',
    category: 'business',
    popularityScore: 83,
  }),
  makeTrend({
    id: 'trend_one_thing',
    title: 'The one thing nobody tells you',
    format: 'The one thing nobody tells you about {topic}',
    description: 'Single-take talking head revealing an overlooked detail.',
    category: 'lifestyle',
    popularityScore: 71,
  }),
  makeTrend({
    id: 'trend_rate_my_setup',
    title: 'Rate my setup out of 10',
    format: 'Rate my {thing} out of 10',
    description: 'Fast-cut review of a viewer-submitted setup with a score card.',
    category: 'tech',
    popularityScore: 64,
  }),
];

function relevanceOf(dna: CreatorDna, trendId: string): number {
  const trend = EVAL_TRENDS.find((candidate) => candidate.id === trendId);
  if (trend === undefined) throw new Error(`fixture trend ${trendId} is missing`);
  return computeTrendRelevance(dna, trend).relevance;
}

describe('trend relevance eval fixtures', () => {
  it('scores every fixture inside 0-100', () => {
    for (const dna of Object.values(EVAL_DNAS)) {
      for (const trend of EVAL_TRENDS) {
        const { relevance } = computeTrendRelevance(dna, trend);
        expect(relevance).toBeGreaterThanOrEqual(0);
        expect(relevance).toBeLessThanOrEqual(100);
      }
    }
  });

  it('is deterministic: the same DNA + trend always scores the same', () => {
    const first = computeTrendRelevance(EVAL_DNAS.dsaCoach, EVAL_TRENDS[0] as Trend);
    const second = computeTrendRelevance(EVAL_DNAS.dsaCoach, EVAL_TRENDS[0] as Trend);
    expect(second).toEqual(first);
  });

  it('explains every score with at least one reason when it is a strong match', () => {
    const { relevance, reasons } = computeTrendRelevance(
      EVAL_DNAS.dsaCoach,
      EVAL_TRENDS[0] as Trend,
    );
    expect(relevance).toBeGreaterThan(50);
    expect(reasons.length).toBeGreaterThan(0);
  });

  // --- per-fixture trait checks ------------------------------------------

  describe('dsaCoach: education trends beat everything else', () => {
    const ranked = rankTrends(EVAL_DNAS.dsaCoach, EVAL_TRENDS);

    it('puts the education POV trend first', () => {
      expect(ranked[0]?.trend.id).toBe('trend_pov_finally');
    });

    it('ranks both education trends above the unrelated ones', () => {
      const ids = ranked.map((entry) => entry.trend.id);
      const education = ids.indexOf('trend_i_was_wrong');
      const gaming = ids.indexOf('trend_aged_badly');
      const fitness = ids.indexOf('trend_before_after');
      expect(education).toBeLessThan(gaming);
      expect(education).toBeLessThan(fitness);
    });

    it('scores an education trend above a fitness trend for the same creator', () => {
      expect(relevanceOf(EVAL_DNAS.dsaCoach, 'trend_pov_finally')).toBeGreaterThan(
        relevanceOf(EVAL_DNAS.dsaCoach, 'trend_before_after'),
      );
    });
  });

  describe('moneyBasics: finance trends lead', () => {
    it('ranks the finance countdown first', () => {
      const ranked = rankTrends(EVAL_DNAS.moneyBasics, EVAL_TRENDS);
      expect(ranked[0]?.trend.id).toBe('trend_three_mistakes');
    });

    it('still likes education formats less than finance ones', () => {
      expect(relevanceOf(EVAL_DNAS.moneyBasics, 'trend_three_mistakes')).toBeGreaterThan(
        relevanceOf(EVAL_DNAS.moneyBasics, 'trend_pov_finally'),
      );
    });
  });

  describe('retroGamer: entertainment trends lead', () => {
    it('ranks the "aged badly" trend first', () => {
      const ranked = rankTrends(EVAL_DNAS.retroGamer, EVAL_TRENDS);
      expect(ranked[0]?.trend.id).toBe('trend_aged_badly');
    });

    it('is the mirror image of dsaCoach: education sinks', () => {
      const educationForGamer = relevanceOf(EVAL_DNAS.retroGamer, 'trend_pov_finally');
      const educationForCoach = relevanceOf(EVAL_DNAS.dsaCoach, 'trend_pov_finally');
      expect(educationForGamer).toBeLessThan(educationForCoach);
    });
  });

  describe('strengthCoach: fitness trends lead', () => {
    it('ranks the transformation trend first', () => {
      const ranked = rankTrends(EVAL_DNAS.strengthCoach, EVAL_TRENDS);
      expect(ranked[0]?.trend.id).toBe('trend_before_after');
    });

    it('cares about the audience it addresses', () => {
      const { reasons } = computeTrendRelevance(
        EVAL_DNAS.strengthCoach,
        EVAL_TRENDS[3] as Trend,
      );
      expect(reasons.join(' ')).toContain('audience');
    });
  });

  describe('indieFounder: business trends lead', () => {
    it('ranks the MRR screenshot trend first', () => {
      const ranked = rankTrends(EVAL_DNAS.indieFounder, EVAL_TRENDS);
      expect(ranked[0]?.trend.id).toBe('trend_mrr_screenshot');
    });

    it('scores business above education for the same creator', () => {
      expect(relevanceOf(EVAL_DNAS.indieFounder, 'trend_mrr_screenshot')).toBeGreaterThan(
        relevanceOf(EVAL_DNAS.indieFounder, 'trend_pov_finally'),
      );
    });
  });

  // --- the acceptance criterion: changing the DNA changes the order -------

  it('changing the DNA visibly changes the ranking', () => {
    const before = rankTrends(EVAL_DNAS.dsaCoach, EVAL_TRENDS).map((e) => e.trend.id);
    const after = rankTrends(EVAL_DNAS.retroGamer, EVAL_TRENDS).map((e) => e.trend.id);
    expect(after).not.toEqual(before);
    expect(before[0]).not.toBe(after[0]);
  });

  it('a one-word niche change is enough to reorder the top slot', () => {
    const original = rankTrends(EVAL_DNAS.moneyBasics, EVAL_TRENDS)[0]?.trend.id;
    const retargeted = rankTrends(
      makeDna({ ...EVAL_DNAS.moneyBasics, niche: 'Retro game reviews' }),
      EVAL_TRENDS,
    )[0]?.trend.id;
    expect(retargeted).not.toBe(original);
    expect(retargeted).toBe('trend_aged_badly');
  });

  it('an empty profile degrades to popularity order rather than throwing', () => {
    const ranked = rankTrendsByPopularity(EVAL_TRENDS);
    expect(ranked.map((entry) => entry.trend.id)).toEqual([
      'trend_pov_finally',
      'trend_before_after',
      'trend_mrr_screenshot',
      'trend_aged_badly',
      'trend_i_was_wrong',
      'trend_one_thing',
      'trend_three_mistakes',
      'trend_rate_my_setup',
    ]);
  });

  // --- blending with the model score --------------------------------------

  it('blends the model score with the heuristic, bounded to 0-100', () => {
    expect(blendTrendRelevance(40, 90)).toBe(65);
    expect(blendTrendRelevance(40, undefined)).toBe(40);
    expect(blendTrendRelevance(90, 100)).toBe(95);
    expect(blendTrendRelevance(0, 0)).toBe(0);
  });

  it('a strong model score cannot rescue a zero heuristic beyond the weight', () => {
    // weight 0.5 => the model can add at most half the range.
    expect(blendTrendRelevance(0, 100)).toBe(50);
  });

  it('clamps a nonsensical model score instead of trusting it', () => {
    // 250 and -30 are impossible percentages; they are clamped to 100 and 0
    // before blending, so a broken model answer cannot corrupt the ranking.
    expect(blendTrendRelevance(50, 250)).toBe(75);
    expect(blendTrendRelevance(50, -30)).toBe(25);
    expect(blendTrendRelevance(50, Number.NaN)).toBe(50);
  });
});
