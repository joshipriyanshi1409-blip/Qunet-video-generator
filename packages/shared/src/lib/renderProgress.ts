import type { RenderStage } from '../schemas/renderJob.schema.js';

/**
 * Stage plan and progress arithmetic for the render pipeline.
 *
 * One place decides how far along a render is, because three separate readers
 * need to agree: the worker that reports it, the API that stores it, and the
 * browser that draws a bar from it. Weights sum to exactly 100 so a finished
 * pipeline reads 100% and no rounding drift accumulates across stages.
 */

export interface RenderStagePlanEntry {
  readonly stage: RenderStage;
  /** Short label the browser can show next to the bar. */
  readonly label: string;
  /** Percentage points this stage is worth. */
  readonly weight: number;
}

export const RENDER_STAGE_PLAN: readonly RenderStagePlanEntry[] = [
  { stage: 'script', label: 'Writing the script', weight: 20 },
  { stage: 'storyboard', label: 'Breaking it into scenes', weight: 15 },
  { stage: 'assets', label: 'Generating visuals', weight: 25 },
  { stage: 'voice', label: 'Recording the voice-over', weight: 10 },
  { stage: 'music', label: 'Scoring the music', weight: 8 },
  { stage: 'captions', label: 'Timing the captions', weight: 8 },
  { stage: 'compose', label: 'Composing the video', weight: 10 },
  { stage: 'qc', label: 'Checking the output', weight: 4 },
] as const;

/** Stages that do real work, in order. `queued`, `completed` and `failed` are
 *  states rather than stages, and are deliberately absent. */
export const RENDER_STAGES = RENDER_STAGE_PLAN.map((entry) => entry.stage);

const BY_STAGE = new Map<RenderStage, RenderStagePlanEntry>(
  RENDER_STAGE_PLAN.map((entry) => [entry.stage, entry]),
);

/** Human label for a stage, or the stage itself when it is not a real stage. */
export function stageLabel(stage: RenderStage): string {
  return BY_STAGE.get(stage)?.label ?? stage;
}

/** Percentage points earned *before* `stage` starts. */
export function stageStartProgress(stage: RenderStage): number {
  let total = 0;
  for (const entry of RENDER_STAGE_PLAN) {
    if (entry.stage === stage) break;
    total += entry.weight;
  }
  return total;
}

/** Percentage points earned once `stage` is done. */
export function stageEndProgress(stage: RenderStage): number {
  const entry = BY_STAGE.get(stage);
  if (entry === undefined) return stage === 'completed' ? 100 : 0;
  return stageStartProgress(stage) + entry.weight;
}

/**
 * Progress for a stage part-way through.
 *
 * `fraction` is clamped to 0..1 so a worker reporting 1.4 (or a negative, from a
 * clock that went backwards) cannot push the bar past where the next stage
 * starts.
 */
export function stageProgress(stage: RenderStage, fraction = 0): number {
  const start = stageStartProgress(stage);
  const end = stageEndProgress(stage);
  const safe = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
  return Math.round(start + (end - start) * safe);
}

/** The stage after `stage`, or `null` at the end of the plan. */
export function nextStage(stage: RenderStage): RenderStage | null {
  const index = RENDER_STAGES.indexOf(stage);
  if (index < 0 || index === RENDER_STAGES.length - 1) return null;
  return RENDER_STAGES[index + 1] ?? null;
}

/** The stage before `stage`, or `null` at the start of the plan. */
export function previousStage(stage: RenderStage): RenderStage | null {
  const index = RENDER_STAGES.indexOf(stage);
  if (index <= 0) return null;
  return RENDER_STAGES[index - 1] ?? null;
}

/** True when the render will not move again on its own. */
export function isTerminalStage(stage: RenderStage): boolean {
  return stage === 'completed' || stage === 'failed';
}

/**
 * True when a stage can be retried.
 *
 * Only a *stage* failure is retryable. A job that never started (`queued`) has
 * nothing to resume, and one that finished has nothing to fix.
 */
export function isRetryableStage(stage: RenderStage): boolean {
  return RENDER_STAGES.includes(stage) && stage !== 'queued';
}

/**
 * Stages whose assets are already on the job when resuming from `stage`.
 *
 * This is the list a retry must *not* redo. Deriving it from the plan means a
 * new stage inserted into the pipeline is skipped automatically rather than
 * silently re-run at full cost.
 */
export function completedStagesBefore(stage: RenderStage): RenderStage[] {
  const index = RENDER_STAGES.indexOf(stage);
  if (index <= 0) return [];
  return RENDER_STAGES.slice(0, index);
}

/** Total pipeline weight, asserted by the tests to be exactly 100. */
export const RENDER_TOTAL_WEIGHT = RENDER_STAGE_PLAN.reduce(
  (total, entry) => total + entry.weight,
  0,
);
