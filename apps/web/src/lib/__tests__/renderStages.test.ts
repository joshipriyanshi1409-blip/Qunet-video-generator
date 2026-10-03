import { describe, expect, it } from 'vitest';
import {
  RENDER_UI_STAGES,
  RENDER_UI_TOTAL_WEIGHT,
  stepFraction,
  stepState,
  uiStageFor,
  uiStageIndex,
  uiStageWeight,
} from '../renderStages';

/**
 * The mapping between the pipeline's eight stages and the seven the creator sees.
 *
 * If these drift, a progress screen shows a step that never runs - so the weights
 * are asserted to add up and every pipeline stage is asserted to be covered.
 */

describe('the UI stage list', () => {
  it('shows the seven steps the creator cares about', () => {
    expect(RENDER_UI_STAGES.map((stage) => stage.label)).toEqual([
      'Script',
      'Visuals',
      'Voice',
      'Music',
      'Captions',
      'Compose',
      'QC',
    ]);
  });

  it('covers every pipeline stage exactly once', () => {
    const covered = RENDER_UI_STAGES.flatMap((stage) => stage.stages);
    expect(covered).toHaveLength(new Set(covered).size);
    expect(new Set(covered).size).toBe(8);
  });

  it('folds the two script stages into one step', () => {
    expect(uiStageFor('storyboard')?.label).toBe('Script');
    expect(uiStageFor('script')?.label).toBe('Script');
  });

  it('weights add up to 100', () => {
    expect(RENDER_UI_TOTAL_WEIGHT).toBe(100);
  });

  it('gives visuals the most weight, because that is the slow stage', () => {
    const visuals = uiStageWeight(RENDER_UI_STAGES[1] ?? { id: '', label: '', stages: [] });
    const compose = uiStageWeight(RENDER_UI_STAGES[5] ?? { id: '', label: '', stages: [] });
    expect(visuals).toBeGreaterThan(compose);
  });

  it('has no UI step for a state that is not a stage', () => {
    expect(uiStageIndex('queued')).toBe(-1);
    expect(uiStageIndex('failed')).toBe(-1);
    expect(uiStageIndex('completed')).toBe(-1);
    expect(uiStageFor('failed')).toBeNull();
  });
});

describe('stepState', () => {
  it('marks everything before the current step done', () => {
    expect(stepState(0, { currentIndex: 3, failed: false })).toBe('done');
    expect(stepState(2, { currentIndex: 3, failed: false })).toBe('done');
  });

  it('marks the current step current', () => {
    expect(stepState(3, { currentIndex: 3, failed: false })).toBe('current');
  });

  it('marks everything after pending', () => {
    expect(stepState(4, { currentIndex: 3, failed: false })).toBe('pending');
    expect(stepState(6, { currentIndex: 3, failed: false })).toBe('pending');
  });

  it('marks the current step failed when the job failed', () => {
    expect(stepState(3, { currentIndex: 3, failed: true })).toBe('failed');
  });

  it('leaves the other steps alone when the job failed', () => {
    // A failure is one stage's failure; the steps before it still did their work.
    expect(stepState(2, { currentIndex: 3, failed: true })).toBe('done');
    expect(stepState(4, { currentIndex: 3, failed: true })).toBe('pending');
  });

  it('treats an unknown index as pending', () => {
    expect(stepState(-1, { currentIndex: 3, failed: false })).toBe('pending');
  });
});

describe('stepFraction', () => {
  it('is zero at the start of a step', () => {
    expect(stepFraction(0, 0)).toBe(0);
  });

  it('is one at the end of a step', () => {
    // Script is worth 35 points (script 20 + storyboard 15).
    expect(stepFraction(35, 0)).toBe(1);
  });

  it('is half way through a step at its midpoint', () => {
    expect(stepFraction(17.5, 0)).toBeCloseTo(0.5, 5);
  });

  it('clamps outside the step span', () => {
    expect(stepFraction(-10, 0)).toBe(0);
    expect(stepFraction(200, 0)).toBe(1);
  });

  it('is zero for an unknown step', () => {
    expect(stepFraction(50, -1)).toBe(0);
    expect(stepFraction(50, 99)).toBe(0);
  });

  it('moves within a step rather than jumping between steps', () => {
    // Visuals is worth 25, starting at 35.
    expect(stepFraction(35, 1)).toBe(0);
    expect(stepFraction(47.5, 1)).toBeCloseTo(0.5, 5);
    expect(stepFraction(60, 1)).toBe(1);
  });
});
