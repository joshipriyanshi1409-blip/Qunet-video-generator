import { describe, expect, it } from 'vitest';
import {
  COST_LIMITS,
  STORYBOARD_LIMITS,
  storyboardDurationSeconds,
  storyboardSchema,
  type Storyboard,
} from '../index.js';

/**
 * A storyboard is the plan the render pipeline runs off, so its limits are the
 * cost guards: one clip per scene caps the bill, and the duration window is the
 * difference between a short and something else.
 */

function scene(overrides: Partial<Storyboard['scenes'][number]> = {}) {
  return {
    sceneId: 'scene-1',
    duration: 10,
    narration: 'POV: three days of staring at the same bug.',
    visualPrompt: 'A developer at a desk at night, screen glow, close shot.',
    onScreenText: '',
    ...overrides,
  };
}

/** A storyboard that adds up to a legal runtime. */
function legal(): Storyboard {
  return storyboardSchema.parse({
    scenes: [scene({ sceneId: 'scene-1', duration: 16 }), scene({ sceneId: 'scene-2', duration: 14 })],
  });
}

describe('storyboardSchema', () => {
  it('accepts a storyboard inside the duration window', () => {
    const board = legal();
    expect(board.scenes).toHaveLength(2);
    expect(storyboardDurationSeconds(board.scenes)).toBe(30);
  });

  it('defaults onScreenText to an empty string', () => {
    const board = storyboardSchema.parse({ scenes: [scene({ sceneId: 'scene-1', duration: 15 })] });
    expect(board.scenes[0]?.onScreenText).toBe('');
  });

  it('accepts the shortest and longest legal runtimes', () => {
    const min = storyboardSchema.parse({ scenes: [scene({ duration: COST_LIMITS.minDurationSeconds })] });
    const max = storyboardSchema.parse({ scenes: [scene({ duration: COST_LIMITS.maxDurationSeconds })] });
    expect(storyboardDurationSeconds(min.scenes)).toBe(COST_LIMITS.minDurationSeconds);
    expect(storyboardDurationSeconds(max.scenes)).toBe(COST_LIMITS.maxDurationSeconds);
  });

  it('rejects a storyboard that is too short to be a short', () => {
    const result = storyboardSchema.safeParse({ scenes: [scene({ duration: 6 })] });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).toContain(`${COST_LIMITS.minDurationSeconds}-${COST_LIMITS.maxDurationSeconds}`);
  });

  it('rejects a storyboard that is too long', () => {
    const result = storyboardSchema.safeParse({
      scenes: [scene({ duration: 30 }), scene({ duration: 20 })],
    });
    expect(result.success).toBe(false);
  });

  it('rejects more scenes than the cost guard allows', () => {
    const scenes = Array.from({ length: COST_LIMITS.maxScenesPerVideo + 1 }, (_, index) =>
      scene({ sceneId: `scene-${index}`, duration: 3 }),
    );
    const result = storyboardSchema.safeParse({ scenes });
    // Zod reports the array-length failure against the array itself, and the
    // duration failure against 'scenes' too - both are the cost guard firing.
    expect(result.error?.issues[0]?.path).toEqual(['scenes']);
  });

  it('rejects duplicate scene ids, because assets are keyed off them', () => {
    const result = storyboardSchema.safeParse({
      scenes: [scene({ sceneId: 'scene-1', duration: 10 }), scene({ sceneId: 'scene-1', duration: 10 })],
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).toContain('Duplicate sceneId');
  });

  it('rejects an empty scene list', () => {
    expect(storyboardSchema.safeParse({ scenes: [] }).success).toBe(false);
  });

  it('rejects a scene with no narration', () => {
    const result = storyboardSchema.safeParse({ scenes: [scene({ duration: 15, narration: '   ' })] });
    expect(result.success).toBe(false);
  });

  it('rejects a scene with no visual prompt', () => {
    const result = storyboardSchema.safeParse({ scenes: [scene({ duration: 15, visualPrompt: '' })] });
    expect(result.success).toBe(false);
  });

  it('rejects a scene shorter than a second', () => {
    const result = storyboardSchema.safeParse({ scenes: [scene({ duration: 0.4 })] });
    expect(result.success).toBe(false);
  });
});

describe('STORYBOARD_LIMITS', () => {
  it('mirrors the shared cost limits so the two cannot drift', () => {
    expect(STORYBOARD_LIMITS.maxScenes).toBe(COST_LIMITS.maxScenesPerVideo);
    expect(STORYBOARD_LIMITS.minDurationSeconds).toBe(COST_LIMITS.minDurationSeconds);
    expect(STORYBOARD_LIMITS.maxDurationSeconds).toBe(COST_LIMITS.maxDurationSeconds);
    expect(STORYBOARD_LIMITS.defaultDurationSeconds).toBe(COST_LIMITS.defaultDurationSeconds);
  });

  it('keeps the window inside what one video generator can produce', () => {
    expect(STORYBOARD_LIMITS.minDurationSeconds).toBeLessThan(STORYBOARD_LIMITS.maxDurationSeconds);
  });
});

describe('storyboardDurationSeconds', () => {
  it('adds the scenes up', () => {
    expect(storyboardDurationSeconds([{ duration: 7 }, { duration: 8 }])).toBe(15);
  });

  it('is zero for an empty list', () => {
    expect(storyboardDurationSeconds([])).toBe(0);
  });
});
