import { z } from 'zod';
import { COST_LIMITS } from '../constants/index.js';

/**
 * Storyboard contracts.
 *
 * A storyboard is the bridge between a script (which the creator wrote) and a
 * video (which the pipeline generates). Every scene carries its own duration,
 * its own narration and its own visual prompt, because each of those becomes a
 * separate asset: a clip, a voice-over, a caption track. A storyboard that said
 * only "3 scenes" could not be rendered, and could not be retried one scene at a
 * time.
 */

/** One scene of the finished short. */
export const storyboardSceneSchema = z.object({
  /** Stable within the storyboard; the pipeline keys every asset off it. */
  sceneId: z.string().trim().min(1).max(40),
  /** How long this scene is on screen, in seconds. */
  duration: z
    .number()
    .min(1)
    .max(COST_LIMITS.maxDurationSeconds)
    .describe('Seconds this scene is on screen.'),
  /** What the voice-over says over this scene. */
  narration: z.string().trim().min(1).max(1200),
  /** The visual description handed to the clip generator. */
  visualPrompt: z.string().trim().min(1).max(1200),
  /** Short text burned onto the frame, or empty for none. */
  onScreenText: z.string().trim().max(200).default(''),
});

export const storyboardSchema = z
  .object({
    scenes: z
      .array(storyboardSceneSchema)
      .min(1)
      .max(COST_LIMITS.maxScenesPerVideo)
      .describe(`At most ${COST_LIMITS.maxScenesPerVideo} scenes - one clip each.`),
  })
  .superRefine((storyboard, ctx) => {
    // The duration rule is the one cost guard that has to hold no matter what
    // the model felt like writing: a 3-minute short is a different product, and
    // a 4-second one cannot carry a sentence.
    const total = storyboard.scenes.reduce((sum, scene) => sum + scene.duration, 0);
    if (total < COST_LIMITS.minDurationSeconds || total > COST_LIMITS.maxDurationSeconds) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['scenes'],
        message:
          `Total duration must be ${COST_LIMITS.minDurationSeconds}-${COST_LIMITS.maxDurationSeconds} seconds; ` +
          `got ${total}.`,
      });
    }

    // Scene ids are the keys every asset is stored under, so a duplicate would
    // silently overwrite one scene's clip with another's.
    const seen = new Set<string>();
    for (const [index, scene] of storyboard.scenes.entries()) {
      if (seen.has(scene.sceneId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['scenes', index, 'sceneId'],
          message: `Duplicate sceneId "${scene.sceneId}".`,
        });
      }
      seen.add(scene.sceneId);
    }
  });

/** Total runtime of a storyboard, in seconds. */
export function storyboardDurationSeconds(scenes: readonly { duration: number }[]): number {
  return scenes.reduce((total, scene) => total + scene.duration, 0);
}

/** The cost limits the storyboard has to respect, for prompts and error text. */
export const STORYBOARD_LIMITS = {
  minScenes: 1,
  maxScenes: COST_LIMITS.maxScenesPerVideo,
  minDurationSeconds: COST_LIMITS.minDurationSeconds,
  maxDurationSeconds: COST_LIMITS.maxDurationSeconds,
  defaultDurationSeconds: COST_LIMITS.defaultDurationSeconds,
} as const;

export type StoryboardScene = z.infer<typeof storyboardSceneSchema>;
export type Storyboard = z.infer<typeof storyboardSchema>;
