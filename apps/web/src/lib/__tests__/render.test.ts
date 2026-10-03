import { describe, expect, it } from 'vitest';
import { jobStatusResponseSchema } from '@creatordna/shared';
import { downloadStem } from '../download';
import { findMp4Asset, isTerminalState, toRenderJobView } from '../render';

/**
 * The render REST client's narrowing helpers.
 *
 * `jobStatusResponseSchema` is deliberately open, so every field the screens read
 * is narrowed in exactly one place. These tests are about that narrowing holding
 * when the payload is missing or the wrong type - the API's own validation covers
 * the happy path.
 */

function jobStatus(overrides: Record<string, unknown> = {}) {
  return jobStatusResponseSchema.parse({
    jobId: 'job_1',
    name: 'render-video',
    state: 'active',
    progress: 40,
    attemptsMade: 1,
    failedReason: null,
    returnvalue: null,
    data: { projectId: 'proj_1', hook: 'POV: binary search', script: [], cta: 'Follow' },
    stage: 'assets',
    assets: [{ kind: 'clip', storagePath: 'renders/u/job_1/scene-0.mp4', sceneIndex: 0 }],
    error: null,
    ...overrides,
  });
}

describe('toRenderJobView', () => {
  it('reads the render fields off the document', () => {
    const view = toRenderJobView(jobStatus());
    expect(view.stage).toBe('assets');
    expect(view.progress).toBe(40);
    expect(view.projectId).toBe('proj_1');
    expect(view.hook).toBe('POV: binary search');
    expect(view.assets).toHaveLength(1);
  });

  it('falls back to queued when the document has no stage', () => {
    const view = toRenderJobView(jobStatus({ stage: undefined }));
    expect(view.stage).toBe('queued');
  });

  it('falls back to zero progress when the queue reports an object', () => {
    // BullMQ allows a progress object; the render screens want a number.
    const view = toRenderJobView(jobStatus({ progress: { scene: 2 } }));
    expect(view.progress).toBe(0);
  });

  it('reads null project and hook rather than undefined', () => {
    const view = toRenderJobView(jobStatus({ data: {} }));
    expect(view.projectId).toBeNull();
    expect(view.hook).toBeNull();
  });
});

describe('isTerminalState', () => {
  it('is true for completed and failed', () => {
    expect(isTerminalState('completed')).toBe(true);
    expect(isTerminalState('failed')).toBe(true);
  });

  it('is false for everything in between', () => {
    expect(isTerminalState('waiting')).toBe(false);
    expect(isTerminalState('active')).toBe(false);
    expect(isTerminalState('delayed')).toBe(false);
  });
});

describe('findMp4Asset', () => {
  it('finds the mp4', () => {
    const status = jobStatus({
      assets: [
        { kind: 'storyboard', storagePath: 'renders/u/job_1/sb.json' },
        { kind: 'mp4', storagePath: 'renders/u/job_1/final.mp4', url: 'https://x/final.mp4' },
      ],
    });
    expect(findMp4Asset(status.assets)?.url).toBe('https://x/final.mp4');
  });

  it('returns null when the job has no mp4 yet', () => {
    expect(findMp4Asset(jobStatus().assets)).toBeNull();
    expect(findMp4Asset([])).toBeNull();
  });
});

describe('downloadStem', () => {
  it('slugifies the title and appends the job id', () => {
    expect(downloadStem('job_1', 'POV: binary search finally clicks!')).toBe(
      'pov-binary-search-finally-clicks-job_1',
    );
  });

  it('falls back to the job id when the title has no usable characters', () => {
    expect(downloadStem('job_1', '!!!')).toBe('job_1');
  });

  it('caps the slug so the filename stays sane', () => {
    const stem = downloadStem('job_1', 'a'.repeat(200));
    expect(stem.length).toBeLessThan(80);
    expect(stem.endsWith('job_1')).toBe(true);
  });
});
