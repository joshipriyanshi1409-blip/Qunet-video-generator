import { describe, expect, it } from 'vitest';
import {
  API_VERSION,
  AUDIENCE_SEGMENT_PRESETS,
  COST_LIMITS,
  HOOK_ANGLES,
  JOB_NAMES,
  PIPELINE_STAGES,
  QUEUE_NAMES,
  WS_CLOSE_CODES,
  WS_EVENTS,
} from '../constants/index.js';
import { renderStageSchema } from '../schemas/renderJob.schema.js';

describe('queue constants', () => {
  it('uses one queue per kind of work', () => {
    expect(QUEUE_NAMES).toEqual({ ping: 'ping', render: 'render' });
  });

  it('names the demo ping job', () => {
    expect(JOB_NAMES.ping).toBe('ping');
    expect(API_VERSION).toBe('v1');
  });
});

describe('PIPELINE_STAGES', () => {
  it('stays in sync with the schema and excludes the failed terminal state', () => {
    expect(PIPELINE_STAGES).not.toContain('failed');
    expect(PIPELINE_STAGES).toHaveLength(renderStageSchema.options.length - 1);
    expect(PIPELINE_STAGES).toEqual([
      'queued',
      'script',
      'storyboard',
      'assets',
      'voice',
      'music',
      'captions',
      'compose',
      'qc',
      'completed',
    ]);
  });

  it('contains no duplicates', () => {
    expect(new Set(PIPELINE_STAGES).size).toBe(PIPELINE_STAGES.length);
  });
});

describe('COST_LIMITS', () => {
  it('caps scenes and duration inside the 15-45s window', () => {
    expect(COST_LIMITS.maxScenesPerVideo).toBe(8);
    expect(COST_LIMITS.minDurationSeconds).toBe(15);
    expect(COST_LIMITS.maxDurationSeconds).toBe(45);
    expect(COST_LIMITS.minDurationSeconds).toBeLessThan(COST_LIMITS.maxDurationSeconds);
  });

  it('has a per-user daily quota for renders and AI calls', () => {
    expect(COST_LIMITS.maxDailyRendersPerUser).toBeGreaterThan(0);
    expect(COST_LIMITS.maxDailyAiCallsPerUser).toBeGreaterThan(0);
  });
});

describe('UI/WS constants', () => {
  it('offers audience segment presets', () => {
    expect(AUDIENCE_SEGMENT_PRESETS.length).toBeGreaterThan(3);
    expect(AUDIENCE_SEGMENT_PRESETS).toContain('Gen Z');
  });

  it('lists the hook angles used by Hook Lab', () => {
    expect(HOOK_ANGLES).toContain('contrarian');
  });

  it('uses the 4401 close code for unauthenticated sockets', () => {
    expect(WS_CLOSE_CODES.unauthorized).toBe(4401);
    expect(WS_EVENTS.renderProgress).toBe('render.progress');
  });
});
