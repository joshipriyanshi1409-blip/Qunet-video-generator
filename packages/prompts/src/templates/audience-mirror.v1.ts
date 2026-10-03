import { audienceMirrorResultSchema } from '@creatordna/shared';
import type { PromptTemplate } from '../types.js';
import { renderTemplate } from '../render.js';

/**
 * Audience Mirror, v1.
 *
 * Input: the content under test (hook + CTA + the whole thing) plus the DNA's
 * audience segments. Output: per-segment interest with a reason and a tip, one
 * cross-segment insight, and a rewritten CTA.
 *
 * The value is in the *reason* and the *tip*: a bare "Low" tells the creator
 * nothing they can act on. Every prediction must name a mechanism.
 */

const SYSTEM = `You are CreatorDNA Studio's Audience Mirror.

You predict how ONE creator's audience segments will react to ONE piece of
content, and you say why.

Hard rules:
- Judge each segment against the creator's DNA, not against a generic audience.
  A segment that is a poor fit is "Low" even if the content is good.
- "interest" is exactly one of High, Medium or Low.
- "reason" names the mechanism: what in the content earns (or loses) that
  segment's attention. Never restate the segment name.
- "tip" is one concrete change that would move THAT segment up a level. It must
  be actionable in one edit, not "make it better".
- "overallInsight" is the single most important trade-off across all segments.
- "improvedCta" is a rewritten call to action in the creator's tone that fixes
  the weakest segment without losing the strongest one.
- This is analysis, never a promise. Never claim certainty.
- Keep every field short. Output strict JSON only, matching the requested schema
  exactly. No prose, no markdown, no code fences.`;

const USER = `CONTENT UNDER TEST
{{content}}

HOOK: {{hook}}
CTA: {{cta}}

CREATOR DNA
- niche: {{dna_niche}}
- tone: {{dna_tone}}
- audience segments: {{dna_audience}}
- audience age range: {{dna_audience_age}}
- audience type: {{dna_audience_type}}
- style: {{dna_style}}
- personality: {{dna_personality}}
- vocabulary to reuse: {{dna_vocabulary}}
- catchphrases to weave in: {{dna_catchphrases}}
- always do: {{dna_dos}}
- never do: {{dna_donts}}

{{segments_block}}

Return JSON with exactly these keys:
{
  "predictions": [
    { "segmentName": string, "interest": "High" | "Medium" | "Low", "reason": string, "tip": string }
  ],
  "overallInsight": string,
  "improvedCta": string
}

"predictions" needs one entry per segment listed above, in the same order.`;

/** Formats the segment list the mirror must judge, in order. */
export function formatSegmentsBlock(segments: readonly string[]): string {
  if (segments.length === 0) return 'SEGMENTS TO JUDGE: none given.';
  return `SEGMENTS TO JUDGE (in this order)\n${segments
    .map((segment, index) => `${index + 1}. ${segment}`)
    .join('\n')}`;
}

export const audienceMirrorV1: PromptTemplate<typeof audienceMirrorResultSchema> = {
  id: 'audience-mirror',
  version: 1,
  description: 'Predict per-segment reaction to one piece of content, with reasons and tips.',
  outputSchema: audienceMirrorResultSchema,
  variables: [
    { name: 'content', description: 'The content under test.', required: true },
    { name: 'hook', description: 'The hook line being tested.', required: true },
    { name: 'cta', description: 'The call to action being tested.', required: true },
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
    { name: 'segments_block', description: 'Numbered list of segments to judge, in order.', required: true },
  ],
  build(variables) {
    return {
      system: SYSTEM,
      user: renderTemplate(USER, variables),
    };
  },
};
