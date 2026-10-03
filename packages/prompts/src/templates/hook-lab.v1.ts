import { hookSetSchema } from '@creatordna/shared';
import type { PromptTemplate } from '../types.js';
import { renderTemplate } from '../render.js';

/**
 * Hook Lab, v1.
 *
 * Input: an idea (optionally a trend the creator arrived from) plus the DNA.
 * Output: 5-8 hooks, each in a *distinct* style, each with a one-line reason it
 * should work for this creator's audience.
 *
 * The styles are a closed set (`hookStyleSchema`) so the UI can tag them and so
 * "regenerate just the POV one" is a well-defined request.
 */

const SYSTEM = `You are CreatorDNA Studio's Hook Lab.

You write opening hooks for ONE specific creator. Every hook must sound like
them, and every hook must be a different *style*.

The styles, and only these:
- question: asks the viewer something they cannot answer yet
- bold-claim: states something that sounds too strong to be true
- pov: "POV: ..." - puts the viewer inside a moment
- story: opens mid-scene, in the middle of something happening
- contrarian: attacks the obvious advice
- curiosity-gap: names a gap the viewer now has to close

Hard rules:
- Never repeat a style. If you are asked for 6 hooks, use 6 different styles.
- Write in the creator's tone and reuse their vocabulary and catchphrases where
  they fit naturally. Never force a catchphrase in.
- Aim the hook at the creator's audience, not at everybody.
- "whyItWorks" is one short line explaining the mechanism for THIS audience.
- Keep every hook under 140 characters so it fits a caption and a title card.
- Output strict JSON only, matching the requested schema exactly. No prose, no
  markdown, no code fences.`;

const USER = `IDEA: {{idea}}

CREATOR DNA
- niche: {{dna_niche}}
- tone: {{dna_tone}}
- audience: {{dna_audience}}
- audience age range: {{dna_audience_age}}
- audience type: {{dna_audience_type}}
- style: {{dna_style}}
- personality: {{dna_personality}}
- usual format: {{dna_format}}
- vocabulary to reuse: {{dna_vocabulary}}
- catchphrases to weave in: {{dna_catchphrases}}
- always do: {{dna_dos}}
- never do: {{dna_donts}}

{{trend_block}}

Return JSON with exactly these keys:
{
  "hooks": [
    { "id": string, "text": string, "style": string, "whyItWorks": string }
  ]
}

"id" is a short slug, e.g. "h1".

{{count_instruction}}`;

/**
 * The count instruction. Either "N distinct styles" or "exactly one, in this
 * style" for a single-hook regeneration.
 */
export function formatCountInstruction(count: number, style?: string): string {
  if (style === undefined) {
    return `Write exactly ${count} hooks, each in a DIFFERENT style from the list above.`;
  }
  return `Write exactly ONE hook, and it must use the "${style}" style.`;
}

/** The optional trend line, so the variable is never blank. */
export const NO_TREND_CONTEXT = 'None.';

/** Formats the optional trend context for the prompt. */
export function formatTrendBlock(trend: { title: string; format: string } | undefined): string {
  if (trend === undefined) return `TREND BEING REMIXED: ${NO_TREND_CONTEXT}`;
  return `TREND BEING REMIXED: ${trend.title} (${trend.format})`;
}

export const hookLabV1: PromptTemplate<typeof hookSetSchema> = {
  id: 'hook-lab',
  version: 1,
  description: 'Write 5-8 hooks in distinct styles for one creator DNA profile.',
  outputSchema: hookSetSchema,
  variables: [
    { name: 'idea', description: 'The idea the hooks are for.', required: true },
    { name: 'dna_niche', description: 'Creator niche.', required: true },
    { name: 'dna_tone', description: 'Comma-separated tone words.', required: true },
    { name: 'dna_audience', description: 'Comma-separated audience segments.', required: true },
    { name: 'dna_audience_age', description: 'Audience age band.', required: true },
    { name: 'dna_audience_type', description: 'Audience type relative to the creator.', required: true },
    { name: 'dna_style', description: 'Visual/editorial style.', required: true },
    { name: 'dna_personality', description: 'Comma-separated personality traits.', required: true },
    { name: 'dna_vocabulary', description: 'Words the creator uses.', required: true },
    { name: 'dna_catchphrases', description: 'Catchphrases to weave in.', required: true },
    { name: 'dna_dos', description: 'Things the creator always does.', required: true },
    { name: 'dna_donts', description: 'Things the creator never does.', required: true },
    { name: 'trend_block', description: 'Optional trend being remixed, or "None".', required: true },
    { name: 'count_instruction', description: 'How many hooks and whether styles must differ.', required: true },
  ],
  build(variables) {
    return {
      system: SYSTEM,
      user: renderTemplate(USER, variables),
    };
  },
};
