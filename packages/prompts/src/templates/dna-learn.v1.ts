import { dnaSuggestionSetSchema } from '@creatordna/shared';
import type { PromptTemplate } from '../types.js';
import { renderTemplate } from '../render.js';

/**
 * Learning loop, v1.
 *
 * Input: the creator's current DNA plus the behaviours they have actually chosen
 * (hooks picked, remixes approved or rejected, Audience Mirror tips applied).
 * Output: a small set of proposed DNA updates, each with the evidence it came
 * from and a reason the creator can judge.
 *
 * Three rules shape this prompt, and they are the whole design:
 *
 * 1. **Propose, never apply.** The output is a draft. The service stores it as
 *    `pending` and a human decides. Nothing here writes to the profile.
 * 2. **Evidence or nothing.** Every suggestion names the signal ids behind it.
 *    A proposal with no evidence is a guess, and a creator who is shown guesses
 *    learns to dismiss the whole panel.
 * 3. **Conservative on tone.** Tone is the field a creator is most protective of,
 *    so `replace` is only offered when several signals agree, and the rationale
 *    has to say what changed. Adding a word is cheap; relabelling someone's
 *    voice is not.
 */

const SYSTEM = `You are CreatorDNA Studio's learning loop.

You read a creator's DNA profile alongside the choices they have actually made in
the app, and you propose small updates that would make the profile describe them
better.

Hard rules:
- You PROPOSE. You never claim to have changed anything. The creator accepts or
  rejects every proposal themselves.
- Every proposal must cite the signal ids it was reasoned from in "evidence".
  If you cannot cite a signal, do not make the proposal.
- "field" is exactly one of: vocabulary, catchphrases, tone, personality, dos,
  donts, audience, style.
- "action" is "add" (append to a list) or "replace" (overwrite it). Use "replace"
  only for tone, personality, audience or style, and only when the evidence
  clearly contradicts what is there now.
- "value" entries are short - a word, a phrase, one sentence for "style". No
  punctuation-only entries, no duplicates within the proposal.
- "rationale" explains the change in the creator's own terms and names what in
  the evidence supports it. Never say "based on your data".
- Prefer fewer, better proposals. At most 6. An empty list is a valid answer
  when the evidence does not support any change.
- Never propose removing something the creator wrote by hand, and never propose
  a change to "niche" or "format" - those are identity, not style.
- Output strict JSON only, matching the requested schema exactly. No prose, no
  markdown, no code fences.`;

const USER = `CURRENT CREATOR DNA
- niche: {{dna_niche}}
- tone: {{dna_tone}}
- audience segments: {{dna_audience}}
- style: {{dna_style}}
- personality: {{dna_personality}}
- vocabulary: {{dna_vocabulary}}
- catchphrases: {{dna_catchphrases}}
- always do: {{dna_dos}}
- never do: {{dna_donts}}

SIGNALS - what this creator actually chose, most recent last
{{signals_block}}

Return JSON with exactly this shape:
{
  "suggestions": [
    {
      "field": "vocabulary" | "catchphrases" | "tone" | "personality" | "dos" | "donts" | "audience" | "style",
      "action": "add" | "replace",
      "value": string[],
      "rationale": string,
      "evidence": string[]
    }
  ]
}

"evidence" holds signal ids copied from the list above. Omit any suggestion you
cannot support with one.`;

/** Formats the signal list, keeping the id visible so it can be cited back. */
export function formatSignalsBlock(
  signals: readonly { id: string; kind: string; label: string }[],
): string {
  if (signals.length === 0) return 'No signals recorded yet.';
  return signals
    .map((signal, index) => `${index + 1}. [${signal.id}] ${signal.kind}: ${signal.label}`)
    .join('\n');
}

export const dnaLearnV1: PromptTemplate<typeof dnaSuggestionSetSchema> = {
  id: 'dna-learn',
  version: 1,
  description: 'Propose DNA updates from recorded creator signals, with evidence.',
  outputSchema: dnaSuggestionSetSchema,
  variables: [
    { name: 'dna_niche', description: 'Creator niche.', required: true },
    { name: 'dna_tone', description: 'Comma-separated tone words.', required: true },
    { name: 'dna_audience', description: 'Comma-separated audience segments.', required: true },
    { name: 'dna_style', description: 'Visual/editorial style.', required: true },
    { name: 'dna_personality', description: 'Comma-separated personality traits.', required: true },
    { name: 'dna_vocabulary', description: 'Words the creator uses.', required: true },
    { name: 'dna_catchphrases', description: 'Catchphrases to weave in.', required: true },
    { name: 'dna_dos', description: 'Things the creator always does.', required: true },
    { name: 'dna_donts', description: 'Things the creator never does.', required: true },
    { name: 'signals_block', description: 'Numbered signals with ids, in order.', required: true },
  ],
  build(variables) {
    return {
      system: SYSTEM,
      user: renderTemplate(USER, variables),
    };
  },
};
