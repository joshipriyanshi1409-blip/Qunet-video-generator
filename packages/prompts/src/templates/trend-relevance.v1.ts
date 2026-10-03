import { trendRelevanceSchema } from '@creatordna/shared';
import type { PromptTemplate } from '../types.js';
import { renderTemplate } from '../render.js';

/**
 * Trend relevance, v1.
 *
 * Input: the seeded trend catalogue plus the creator's DNA.
 * Output: a 0-100 relevance score and up to three short reasons per trend.
 *
 * This is the only Phase 4 call that is *ranked* rather than *generated*, so it
 * is the one most worth caching: the catalogue changes slowly and the creator's
 * DNA changes rarely, yet without a cache every Home screen load would spend
 * tokens re-deciding an order the creator already saw.
 *
 * The API blends this score with the deterministic heuristic in
 * `@creatordna/shared` (`computeTrendRelevance`), so a cold cache or a degraded
 * model still produces a sane order rather than an error.
 */

const SYSTEM = `You are CreatorDNA Studio's trend matcher.

You score how well each TRENDING FORMAT fits ONE specific creator. A high score
means the creator could shoot that trend tomorrow, in their own voice, for their
own audience - not merely that the topic is vaguely related.

Hard rules:
- Judge fit on: does the creator's niche give them something true to say about
  this format; does their audience care; does their usual format suit it; does
  their tone survive it.
- A trend that is popular but wrong for this creator scores low. Popularity is
  already handled elsewhere - ignore it.
- "reasons" are short, concrete and about the fit, e.g. "your audience is
  beginners and this format teaches one thing". Never more than three.
- Score every trend you were given, exactly once each.
- Output strict JSON only, matching the requested schema exactly. No prose, no
  markdown, no code fences.`;

const USER = `CREATOR DNA
- niche: {{dna_niche}}
- tone: {{dna_tone}}
- audience: {{dna_audience}}
- audience age range: {{dna_audience_age}}
- audience type: {{dna_audience_type}}
- style: {{dna_style}}
- personality: {{dna_personality}}
- usual format: {{dna_format}}
- vocabulary: {{dna_vocabulary}}
- catchphrases: {{dna_catchphrases}}

TRENDING FORMATS
{{trends_block}}

Return JSON with exactly these keys:
{
  "scores": [
    { "trendId": string, "relevance": number, "reasons": string[] }
  ]
}

"relevance" is 0-100. Score every trend listed above.`;

/** One numbered line per trend, so the model can echo ids back reliably. */
export function formatTrendsBlock(
  trends: readonly {
    id: string;
    title: string;
    format: string;
    description: string;
    category: string;
  }[],
): string {
  return trends
    .map(
      (trend, index) =>
        `${index + 1}. ${trend.id} - ${trend.title} | ${trend.format} | ${trend.description} | category: ${trend.category}`,
    )
    .join('\n');
}

export const trendRelevanceV1: PromptTemplate<typeof trendRelevanceSchema> = {
  id: 'trend-relevance',
  version: 1,
  description: 'Score how well each trending format fits one creator DNA profile.',
  outputSchema: trendRelevanceSchema,
  variables: [
    { name: 'dna_niche', description: 'Creator niche.', required: true },
    { name: 'dna_tone', description: 'Comma-separated tone words.', required: true },
    { name: 'dna_audience', description: 'Comma-separated audience segments.', required: true },
    { name: 'dna_audience_age', description: 'Audience age band.', required: true },
    { name: 'dna_audience_type', description: 'Audience type relative to the creator.', required: true },
    { name: 'dna_style', description: 'Visual/editorial style.', required: true },
    { name: 'dna_personality', description: 'Comma-separated personality traits.', required: true },
    { name: 'dna_format', description: 'Usual video format.', required: true },
    { name: 'dna_vocabulary', description: 'Words the creator uses.', required: true },
    { name: 'dna_catchphrases', description: 'Catchphrases to weave in.', required: true },
    { name: 'trends_block', description: 'Numbered list of the trends to score.', required: true },
  ],
  build(variables) {
    return {
      system: SYSTEM,
      user: renderTemplate(USER, variables),
    };
  },
};
