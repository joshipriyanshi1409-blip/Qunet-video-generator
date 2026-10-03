import type { Hook, RankedTrend, TrendRemix } from '@creatordna/shared';

/**
 * Fixtures for the Phase 4 screens.
 *
 * They mirror the shapes the API returns (`/trends/for-me`, `/trends/remix`,
 * `/trends/hooks`) so the tests exercise the same zod validation the browser
 * runs on every response.
 */

export const trendList = {
  trends: [
    {
      trend: {
        id: 'trend_pov_finally',
        title: 'POV: You finally understand ...',
        format: 'POV: you finally understand {concept} after {time}',
        description: 'Creator narrates the moment a concept clicks, then explains it in one line.',
        category: 'education' as const,
        popularityScore: 92,
      },
      relevance: 82,
      reasons: ['education is your strongest category', 'your whiteboard format fits'],
      cached: false,
    },
    {
      trend: {
        id: 'trend_three_mistakes',
        title: 'Three mistakes that keep you stuck',
        format: 'Three mistakes in {topic}, ranked by how much they cost you',
        description: 'A fast list of three common errors, each with a one-line fix.',
        category: 'education' as const,
        popularityScore: 74,
      },
      relevance: 61,
      reasons: ['list format matches your style'],
      cached: false,
    },
  ] satisfies RankedTrend[],
  personalizationLimited: false,
};

export const remix: TrendRemix = {
  trendId: 'trend_pov_finally',
  format: 'POV: you finally understand {concept} after {time}',
  hook: 'POV: you finally understand binary search after 3 days',
  script: [
    { scene: 'Hook', text: 'POV: you have stared at binary search for three days.' },
    { scene: 'Turn', text: 'The trick is the picture of the search space halving.' },
    { scene: 'CTA', text: 'Follow for the next data structure in plain English.' },
  ],
  cta: 'Follow for the next data structure in plain English.',
  caption: 'Binary search finally clicked.',
  hashtags: ['#dsa', '#interviewprep'],
  whatWasKept: ['the POV opening', 'three-beat escalation'],
  whatWasChanged: ['topic swapped to binary search', 'CTA swapped to follow'],
};

export const hooks: Hook[] = [
  {
    id: 'hook-1',
    text: 'Why does your binary search never terminate?',
    style: 'question',
    whyItWorks: 'Names a bug the viewer half-remembers.',
  },
  {
    id: 'hook-2',
    text: 'Binary search is 8 lines. Everyone writes 30.',
    style: 'bold-claim',
    whyItWorks: 'A number the viewer can check.',
  },
  {
    id: 'hook-3',
    text: 'POV: the search space just halved.',
    style: 'pov',
    whyItWorks: 'Puts the viewer inside the algorithm.',
  },
  {
    id: 'hook-4',
    text: 'I watched 400 interviews fail on the same line.',
    style: 'story',
    whyItWorks: 'Opens mid-scene.',
  },
  {
    id: 'hook-5',
    text: 'Stop memorising binary search.',
    style: 'contrarian',
    whyItWorks: 'Attacks the obvious advice.',
  },
  {
    id: 'hook-6',
    text: 'The bug is never in the loop.',
    style: 'curiosity-gap',
    whyItWorks: 'Forces a click to resolve it.',
  },
];

/** A single rewritten hook, as returned for "regenerate this style". */
export const singleHook: Hook[] = [
  {
    id: 'hook-6b',
    text: 'The bug is never where you are looking.',
    style: 'curiosity-gap',
    whyItWorks: 'Forces a click to resolve it.',
  },
];
