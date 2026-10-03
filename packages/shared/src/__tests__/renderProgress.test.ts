import { describe, expect, it } from 'vitest';
import {
  RENDER_STAGE_PLAN,
  RENDER_STAGES,
  type RenderStagePlanEntry,
  RENDER_TOTAL_WEIGHT,
  completedStagesBefore,
  isRetryableStage,
  isTerminalStage,
  nextStage,
  previousStage,
  stageEndProgress,
  stageLabel,
  stageProgress,
  stageStartProgress,
} from '../lib/renderProgress.js';

/** Weight of one stage, read off the plan. */
function weightOf(stage: string): number {
  return RENDER_STAGE_PLAN.find((entry: RenderStagePlanEntry) => entry.stage === stage)?.weight ?? 0;
}

describe('render stage plan', () => {
  it('covers every stage exactly once', () => {
    expect(RENDER_STAGE_PLAN.map((entry) => entry.stage)).toEqual([...RENDER_STAGES]);
  });

  it('weights sum to 100 so a percentage is never fudged', () => {
    expect(RENDER_TOTAL_WEIGHT).toBe(100);
    expect(RENDER_STAGES.reduce((total, stage) => total + weightOf(stage), 0)).toBe(100);
  });

  it('gives every stage a positive weight', () => {
    for (const stage of RENDER_STAGES) {
      expect(weightOf(stage)).toBeGreaterThan(0);
    }
  });

  it('has a human label for every stage', () => {
    for (const stage of RENDER_STAGES) {
      expect(stageLabel(stage).length).toBeGreaterThan(0);
    }
  });
});

describe('stage boundaries', () => {
  it('starts the pipeline at 0', () => {
    expect(stageStartProgress('script')).toBe(0);
  });

  it('ends the pipeline at 100', () => {
    expect(stageEndProgress('qc')).toBe(100);
  });

  it('stacks stages back to back with no gap or overlap', () => {
    let cursor = 0;
    for (const stage of RENDER_STAGES) {
      expect(stageStartProgress(stage)).toBe(cursor);
      cursor = stageEndProgress(stage);
    }
    expect(cursor).toBe(100);
  });

  it('puts assets and voice where most of the work is', () => {
    // Assets are the slowest stage by far (one clip per scene), and the plan
    // should say so rather than making every stage look equally quick.
    expect(weightOf('assets')).toBeGreaterThan(weightOf('script'));
    expect(weightOf('assets')).toBeGreaterThan(weightOf('compose'));
  });
});

describe('stageProgress', () => {
  it('reports the start of a stage at its own boundary', () => {
    expect(stageProgress('script', 0)).toBe(0);
  });

  it('reports the end of a stage at the next stage boundary', () => {
    expect(stageProgress('script', 1)).toBe(stageEndProgress('script'));
  });

  it('places a half-done stage in the middle of its own span', () => {
    // Rounded to a whole percent: the bar has one decimal place at most.
    expect(stageProgress('storyboard', 0.5)).toBe(
      Math.round((stageStartProgress('storyboard') + stageEndProgress('storyboard')) / 2),
    );
  });

  it('clamps a fraction outside 0..1 rather than reporting over 100', () => {
    expect(stageProgress('script', 1.5)).toBe(stageEndProgress('script'));
    expect(stageProgress('script', -2)).toBe(stageStartProgress('script'));
  });
});

describe('stage navigation', () => {
  it('walks forwards through the whole plan', () => {
    const walked: string[] = ['script'];
    for (let stage = nextStage('script'); stage !== null; stage = nextStage(stage)) {
      walked.push(stage);
    }
    expect(walked).toEqual([...RENDER_STAGES]);
  });

  it('walks backwards through the whole plan', () => {
    const walked: string[] = ['qc'];
    for (let stage = previousStage('qc'); stage !== null; stage = previousStage(stage)) {
      walked.unshift(stage);
    }
    expect(walked).toEqual([...RENDER_STAGES]);
  });

  it('stops at both ends', () => {
    expect(nextStage('qc')).toBeNull();
    expect(previousStage('script')).toBeNull();
  });
});

describe('retryability', () => {
  it('allows a retry of every pipeline stage', () => {
    for (const stage of RENDER_STAGES) {
      expect(isRetryableStage(stage)).toBe(true);
    }
  });

  it('refuses a retry of the states that are not stages', () => {
    expect(isRetryableStage('queued')).toBe(false);
    expect(isRetryableStage('failed')).toBe(false);
    expect(isRetryableStage('completed')).toBe(false);
  });

  it('treats only the last stage as terminal', () => {
    expect(isTerminalStage('completed')).toBe(true);
    expect(isTerminalStage('failed')).toBe(true);
    expect(isTerminalStage('qc')).toBe(false);
    expect(isTerminalStage('script')).toBe(false);
  });
});

describe('completedStagesBefore', () => {
  it('has nothing completed before the first stage', () => {
    expect(completedStagesBefore('script')).toEqual([]);
  });

  it('lists every earlier stage, in order', () => {
    expect(completedStagesBefore('assets')).toEqual(['script', 'storyboard']);
  });

  it('has nothing to resume from the terminal states', () => {
    // A finished render is not resumable, and a failed one resumes from whatever
    // stage it failed in - never from "everything is done".
    expect(completedStagesBefore('completed')).toEqual([]);
    expect(completedStagesBefore('failed')).toEqual([]);
  });
});
