import { RENDER_STAGE_PLAN, type RenderStage } from '@creatordna/shared';

/**
 * The seven steps a creator sees, mapped onto the pipeline's eight stages.
 *
 * The pipeline has a `script` and a `storyboard` stage because the worker does
 * two different jobs there; the creator does not care. Showing eight near-
 * identical rows makes a 40-second render look like a 40-minute one, so the two
 * are folded into one "Script" step and the mapping lives here rather than in
 * the component.
 */

export interface RenderUiStage {
  /** Stable id, used for keys and tests. */
  id: string;
  /** The label the creator reads. */
  label: string;
  /** Pipeline stages this step covers, in order. */
  stages: readonly RenderStage[];
}

export const RENDER_UI_STAGES: readonly RenderUiStage[] = [
  { id: 'script', label: 'Script', stages: ['script', 'storyboard'] },
  { id: 'visuals', label: 'Visuals', stages: ['assets'] },
  { id: 'voice', label: 'Voice', stages: ['voice'] },
  { id: 'music', label: 'Music', stages: ['music'] },
  { id: 'captions', label: 'Captions', stages: ['captions'] },
  { id: 'compose', label: 'Compose', stages: ['compose'] },
  { id: 'qc', label: 'QC', stages: ['qc'] },
] as const;

/** Every pipeline stage is covered by exactly one UI step. */
const STAGE_TO_UI = new Map<RenderStage, number>(
  RENDER_UI_STAGES.flatMap((stage, index) => stage.stages.map((name) => [name, index] as const)),
);

/** Index into `RENDER_UI_STAGES`, or -1 for the non-stages. */
export function uiStageIndex(stage: RenderStage): number {
  return STAGE_TO_UI.get(stage) ?? -1;
}

/** The UI step a pipeline stage belongs to. */
export function uiStageFor(stage: RenderStage): RenderUiStage | null {
  const index = uiStageIndex(stage);
  return index < 0 ? null : (RENDER_UI_STAGES[index] ?? null);
}

export type RenderStepState = 'done' | 'current' | 'pending' | 'failed';

/**
 * State of one UI step.
 *
 * `failed` is a whole-job state, not a step state: the pipeline knows which
 * stage failed, so the step that owns it is the one that shows as failed.
 */
export function stepState(
  index: number,
  options: { currentIndex: number; failed: boolean },
): RenderStepState {
  // An index outside the list is "unknown", and claiming a step is done when we
  // do not know which step it is would be a lie on the stepper.
  if (index < 0 || index >= RENDER_UI_STAGES.length) return 'pending';
  if (options.failed === true && index === options.currentIndex) return 'failed';
  if (index < options.currentIndex) return 'done';
  if (index === options.currentIndex) return 'current';
  return 'pending';
}

/** The percentage of the whole job a UI step is worth. */
export function uiStageWeight(stage: RenderUiStage): number {
  // `RENDER_STAGE_PLAN` is the ordered array of entries, not a record, so the
  // weight is looked up by stage rather than indexed.
  return stage.stages.reduce(
    (total, name) => total + (RENDER_STAGE_PLAN.find((entry) => entry.stage === name)?.weight ?? 0),
    0,
  );
}

/** Total weight across every step - 100, because the plan is normalised. */
export const RENDER_UI_TOTAL_WEIGHT = RENDER_UI_STAGES.reduce(
  (total, stage) => total + uiStageWeight(stage),
  0,
);

/**
 * Progress *within* the current step, 0-1.
 *
 * `overall` is the job percentage; subtracting the weight of every finished step
 * and dividing by the current step's own weight is what makes the step's own bar
 * move instead of jumping between steps.
 */
export function stepFraction(overall: number, index: number): number {
  if (index < 0 || index >= RENDER_UI_STAGES.length) return 0;

  let before = 0;
  for (let position = 0; position < index; position += 1) {
    const stage = RENDER_UI_STAGES[position];
    if (stage !== undefined) before += uiStageWeight(stage);
  }

  const stage = RENDER_UI_STAGES[index];
  if (stage === undefined) return 0;

  const weight = uiStageWeight(stage);
  if (weight <= 0) return 0;

  const fraction = (overall - before) / weight;
  return Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
}
