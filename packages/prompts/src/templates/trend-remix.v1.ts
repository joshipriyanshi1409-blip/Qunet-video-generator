import { trendRemixSchema } from '@creatordna/shared';
import type { PromptTemplate } from '../types.js';
import { renderTemplate } from '../render.js';

/**
 * Trend remix, v1.
 *
 * Input: one trending *format* (or a free-text idea) plus the creator's DNA.
 * Output: the same recognizable structure with the creator's topic, examples
 * and CTA - plus an explicit audit trail (`whatWasKept` / `whatWasChanged`) so
 * the "keep the structure, swap the topic" rule is verifiable rather than
 * hoped for.
 *
 * Registered in `src/index.ts`; bump to v2 (never edit v1 in place) when the
 * wording changes so old renders stay reproducible.
 */

const SYSTEM = `You are CreatorDNA Studio's remix engine.

You rewrite a TRENDING FORMAT so it fits one specific creator. The trend's
recognizable structure must survive; the topic, examples and call to action must
belong to the creator.

Hard rules:
- Keep the trend's structural skeleton: its opening pattern, beat order, pacing
  and the shape of its payoff. A viewer who knows the trend must recognise it.
- Replace every topic-specific detail with the creator's niche, their own
  examples and their audience. Never mention another creator, brand or handle.
- Write in the creator's tone, reusing their vocabulary and catchphrases where
  they fit naturally. Never force a catchphrase in.
- The script is a beat list, not a shot list: "scene" names the beat
  (Hook / Setup / Turn / Proof / CTA), "text" is what is said or shown.
- "format" echoes the TREND FORMAT you were given, character for character. It is
  the proof that the structure survived.
- "whatWasKept" lists the structural elements you preserved. "whatWasChanged"
  lists the topic, examples and CTA you swapped. Both are required and both
  must be honest - a reviewer reads them.
- Keep every string short and concrete. Output strict JSON only, matching the
  requested schema exactly. No prose, no markdown, no code fences.`;

const USER = `TREND FORMAT: {{trend_format}}
TREND TITLE: {{trend_title}}
TREND DESCRIPTION: {{trend_description}}
TREND CATEGORY: {{trend_category}}

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

{{idea_block}}

Return JSON with exactly these keys:
{
  "format": string,
  "hook": string,
  "script": [{ "scene": string, "text": string }],
  "cta": string,
  "caption": string,
  "hashtags": string[],
  "whatWasKept": string[],
  "whatWasChanged": string[]
}

"format" echoes TREND FORMAT verbatim. "script" needs 3-6 beats. "hashtags" needs
3-6 tags, each starting with "#".`;

/** The idea line, or an explicit "none" so the variable is never blank. */
export const NO_REMIX_IDEA = 'None - remix the trend itself.';

/** Formats the optional creator-supplied idea for the prompt. */
export function formatIdeaBlock(idea: string | undefined): string {
  if (idea === undefined || idea.trim().length === 0) return `CREATOR'S OWN IDEA: ${NO_REMIX_IDEA}`;
  return `CREATOR'S OWN IDEA (steer the remix toward this): ${idea.trim()}`;
}

export const trendRemixV1: PromptTemplate<typeof trendRemixSchema> = {
  id: 'trend-remix',
  version: 1,
  description: 'Rewrite a trending format so it fits one creator DNA profile.',
  outputSchema: trendRemixSchema,
  variables: [
    { name: 'trend_format', description: 'The recognizable structure of the trend.', required: true },
    { name: 'trend_title', description: 'One instance of the trend.', required: true },
    { name: 'trend_description', description: 'What the trend is about.', required: true },
    { name: 'trend_category', description: 'Trend category.', required: true },
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
    { name: 'dna_dos', description: 'Things the creator always does.', required: true },
    { name: 'dna_donts', description: 'Things the creator never does.', required: true },
    { name: 'idea_block', description: 'Optional creator-supplied idea, or "None".', required: true },
  ],
  build(variables) {
    return {
      system: SYSTEM,
      user: renderTemplate(USER, variables),
    };
  },
};
