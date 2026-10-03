import { z } from 'zod';
import type { PromptTemplate } from '../types.js';
import { renderTemplate } from '../render.js';
import { STORYBOARD_LIMITS } from '@creatordna/shared';

/**
 * Storyboard, v1.
 *
 * Input: the approved hook, the approved script (a beat list), the CTA, and the
 * Creator DNA. Output: one entry per scene, each with its own duration,
 * narration, visual prompt and on-screen text.
 *
 * The scene list is the plan the whole pipeline runs off, so the prompt states
 * the limits as hard numbers rather than guidance: the model is told the exact
 * scene ceiling and the exact duration window, and the service re-prompts once
 * if it gets them wrong.
 */

/** The model's answer for one scene. */
export const storyboardSceneSchema = z.object({
  sceneId: z.string().trim().min(1).max(40),
  duration: z.number().min(1).max(STORYBOARD_LIMITS.maxDurationSeconds),
  narration: z.string().trim().min(1).max(1200),
  visualPrompt: z.string().trim().min(1).max(1200),
  onScreenText: z.string().trim().max(200),
});

/** The model's answer, before the service applies the shared cross-checks. */
export const storyboardDraftSchema = z.object({
  scenes: z.array(storyboardSceneSchema).min(1).max(STORYBOARD_LIMITS.maxScenes),
});

const SYSTEM = `You are CreatorDNA Studio's storyboard artist.

You turn an approved script into a shot list for a vertical short: one entry per
scene, each with a duration, a narration, a visual prompt and on-screen text.

Hard rules:
- At most ${STORYBOARD_LIMITS.maxScenes} scenes. Never more, however much the script wants.
- The scene durations must add up to between ${STORYBOARD_LIMITS.minDurationSeconds} and ${STORYBOARD_LIMITS.maxDurationSeconds} seconds. Count them.
- "sceneId" is a short stable slug, unique within the list: scene-1, scene-2, and so on.
- "narration" is what the voice-over says, in the creator's voice. It carries the
  script's words; it does not invent new claims.
- "visualPrompt" describes one continuous shot: subject, action, framing, mood,
  lighting. Written for a video generator, so no camera jargon it cannot honour
  and no text to be rendered inside the shot - that is what onScreenText is for.
- "onScreenText" is the short line burned onto the frame, or an empty string
  when the frame should stay clean.
- Keep every scene long enough for its narration to be spoken at a normal pace:
  roughly 2.5 spoken words per second, so a 30-word line needs about 12 seconds.
- Output strict JSON only, matching the requested schema exactly. No prose, no
  markdown, no code fences.

When a CONTENT FORMAT is provided below, you MUST follow its structure and visual
style. The format defines the narrative arc, pacing, and visual treatment. Match
the scene count, durations, and visual style to the format's specifications.`;

const USER = `APPROVED HOOK: {{hook}}

APPROVED SCRIPT
{{script_block}}

CALL TO ACTION: {{cta}}

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
{{format_block}}

Plan a vertical short of {{target_seconds}} seconds in at most ${STORYBOARD_LIMITS.maxScenes} scenes.

Return JSON with exactly this shape:
{
  "scenes": [
    {
      "sceneId": string,
      "duration": number,
      "narration": string,
      "visualPrompt": string,
      "onScreenText": string
    }
  ]
}`;

/** Formats the script beats as a numbered list. */
export function formatScriptBlock(script: readonly { scene: string; text: string }[]): string {
  return script
    .map((beat, index) => `${index + 1}. ${beat.scene} - ${beat.text}`)
    .join('\n');
}

/** Content format context for the storyboard prompt. */
export interface StoryboardFormatContext {
  name: string;
  description: string;
  pacing: string;
  visualStyle: string;
  structure: readonly { label: string; description: string }[];
  sceneDuration: { min: number; max: number; default: number };
  musicIntensity: number;
  transitions: readonly string[];
  captionStyle: string;
  narrationStyle: string;
}

/**
 * Formats the content format as a block for the storyboard prompt.
 * When no format is provided, returns an empty string (the variable is still
 * required by the template, but renders as nothing).
 */
export function formatFormatBlock(format: StoryboardFormatContext | null): string {
  if (format === null) return '';

  const structureText = format.structure
    .map((step, i) => `${i + 1}. ${step.label}: ${step.description}`)
    .join('\n');

  return `CONTENT FORMAT: ${format.name}
- Description: ${format.description}
- Pacing: ${format.pacing}
- Visual Style: ${format.visualStyle}
- Caption Style: ${format.captionStyle}
- Narration Style: ${format.narrationStyle}
- Narrative Structure:\n${structureText}
- Scene Duration: ${format.sceneDuration.min}-${format.sceneDuration.max}s (default ${format.sceneDuration.default}s)
- Music Intensity: ${format.musicIntensity} (0-1, where 1 is very intense)
- Transition Style: ${format.transitions.join(', ')}

Match the storyboard to this format's pacing, visual style, and narrative structure.`;
}

export const storyboardV1: PromptTemplate<typeof storyboardDraftSchema> = {
  id: 'storyboard',
  version: 1,
  description: 'Turn an approved script into a timed, per-scene storyboard for a vertical short.',
  outputSchema: storyboardDraftSchema,
  variables: [
    { name: 'hook', description: 'The approved hook.', required: true },
    { name: 'script_block', description: 'Numbered script beats.', required: true },
    { name: 'cta', description: 'The approved call to action.', required: true },
    { name: 'dna_niche', description: 'Creator niche.', required: true },
    { name: 'dna_tone', description: 'Comma-separated tone words.', required: true },
    { name: 'dna_audience', description: 'Comma-separated audience segments.', required: true },
    { name: 'dna_style', description: 'Visual/editorial style.', required: true },
    { name: 'dna_personality', description: 'Comma-separated personality traits.', required: true },
    { name: 'dna_vocabulary', description: 'Words the creator uses.', required: true },
    { name: 'dna_catchphrases', description: 'Catchphrases to weave in.', required: true },
    { name: 'dna_dos', description: 'Things the creator always does.', required: true },
    { name: 'dna_donts', description: 'Things the creator never does.', required: true },
    { name: 'format_block', description: 'Content format context (empty string when no format).', required: true },
    { name: 'target_seconds', description: 'Target runtime for the short.', required: true },
  ],
  build(variables) {
    return {
      system: SYSTEM,
      user: renderTemplate(USER, variables),
    };
  },
};
