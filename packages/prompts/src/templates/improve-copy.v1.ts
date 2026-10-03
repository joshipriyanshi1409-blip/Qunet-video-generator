import { z } from 'zod';
import type { PromptTemplate } from '../types.js';
import { renderTemplate } from '../render.js';

/**
 * Improve copy, v1.
 *
 * Input: the hook and CTA under revision, the Audience Mirror feedback that
 * asked for the change, and the DNA. Output: a rewritten hook and CTA.
 *
 * Both are always returned, even when only one was requested: the model needs
 * the freedom to keep the pair consistent, and the caller keeps only the field
 * the creator asked about. The other one is dropped before it reaches them.
 */

/** The model's answer; the service narrows it to the requested target. */
export const improvedCopySchema = z.object({
  hook: z.string().trim().min(1).max(300),
  cta: z.string().trim().min(1).max(300),
  changedWhat: z.string().trim().min(1).max(300),
});

const SYSTEM = `You are CreatorDNA Studio's copy editor.

You rewrite a creator's hook and call to action so they land better with the
audience segments that were weakest, without losing the segments that were
strongest.

Hard rules:
- Apply the feedback you are given. Every tip that applies to the target must be
  reflected in the rewrite; say in "changedWhat" which ones you applied.
- Keep the creator's tone, vocabulary and catchphrases. A rewrite that sounds
  like somebody else is a failure, however well it scores.
- Keep the hook under 140 characters and the CTA under 120.
- Do not add claims, numbers or promises the creator did not make.
- Change only what the feedback asks for. If the hook is fine, return it
  unchanged rather than churning it.
- Output strict JSON only, matching the requested schema exactly. No prose, no
  markdown, no code fences.`;

const USER = `REWRITE TARGET: {{target}}

CURRENT HOOK: {{hook}}
CURRENT CTA: {{cta}}

AUDIENCE MIRROR FEEDBACK
{{feedback_block}}

CREATOR DNA
- niche: {{dna_niche}}
- tone: {{dna_tone}}
- audience: {{dna_audience}}
- style: {{dna_style}}
- personality: {{dna_personality}}
- vocabulary to reuse: {{dna_vocabulary}}
- catchphrases to weave in: {{dna_catchphrases}}
- always do: {{dna_dos}}
- never do: {{dna_donts}}

Return JSON with exactly these keys:
{
  "hook": string,
  "cta": string,
  "changedWhat": string
}`;

/** Formats the feedback lines, or says plainly that there were none. */
export function formatFeedbackBlock(feedback: readonly string[]): string {
  if (feedback.length === 0) {
    return 'None recorded - improve both lines using your own judgement about the audience.';
  }
  return feedback.map((line, index) => `${index + 1}. ${line}`).join('\n');
}

export const improveCopyV1: PromptTemplate<typeof improvedCopySchema> = {
  id: 'improve-copy',
  version: 1,
  description: 'Rewrite a hook and CTA from Audience Mirror feedback, in the creator voice.',
  outputSchema: improvedCopySchema,
  variables: [
    { name: 'target', description: 'Which line the creator asked to improve.', required: true },
    { name: 'hook', description: 'The current hook.', required: true },
    { name: 'cta', description: 'The current CTA.', required: true },
    { name: 'feedback_block', description: 'Numbered feedback lines, or a plain statement.', required: true },
    { name: 'dna_niche', description: 'Creator niche.', required: true },
    { name: 'dna_tone', description: 'Comma-separated tone words.', required: true },
    { name: 'dna_audience', description: 'Comma-separated audience segments.', required: true },
    { name: 'dna_style', description: 'Visual/editorial style.', required: true },
    { name: 'dna_personality', description: 'Comma-separated personality traits.', required: true },
    { name: 'dna_vocabulary', description: 'Words the creator uses.', required: true },
    { name: 'dna_catchphrases', description: 'Catchphrases to weave in.', required: true },
    { name: 'dna_dos', description: 'Things the creator always does.', required: true },
    { name: 'dna_donts', description: 'Things the creator never does.', required: true },
  ],
  build(variables) {
    return {
      system: SYSTEM,
      user: renderTemplate(USER, variables),
    };
  },
};
