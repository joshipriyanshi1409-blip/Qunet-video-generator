import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { jobStatusResponseSchema, type JobStatusResponse } from '@creatordna/shared';
import {
  DEMO_RENDER_TOTAL_MS,
  handleDemoFallback,
} from '../demoBackend';
import { DEMO_VIDEO_PATH, demoPosterUrl, demoVideoUrl } from '../demoAssets';

/**
 * The demo backend.
 *
 * This is what the public showcase deployments run on, so it has to answer the
 * same contract the real API does: every response below is validated against the
 * shared schema, because the failure this module has had in production is a
 * response that *looked* fine and broke the validator - after which the browser
 * showed "The API returned an unexpected shape" and no video.
 */

const JOBS_KEY = 'creatordna.demo.jobs.v1';

/** A job document as `POST /api/v1/render` stores it, started `agoMs` ago. */
function seedStartedJob(jobId: string, agoMs: number): void {
  const startedAt = Date.now() - agoMs;
  const job: JobStatusResponse = {
    jobId,
    name: 'render-video',
    state: 'waiting',
    progress: 0,
    attemptsMade: 0,
    failedReason: null,
    returnvalue: null,
    data: {
      projectId: 'proj_test',
      hook: 'POV: You finally understand Binary Search after 3 days 😅',
      script: [{ scene: 'Hook', text: 'Binary Search Made Easy' }],
      demoStartedAt: startedAt,
    },
    stage: 'queued',
    assets: [],
    error: null,
  };
  window.localStorage.setItem(JOBS_KEY, JSON.stringify({ [jobId]: job }));
}

/** The schema types `progress` as BullMQ does - a number, a string or an object. */
function progressOf(job: JobStatusResponse): number {
  return typeof job.progress === 'number' ? job.progress : -1;
}

function readJob(jobId: string): JobStatusResponse {
  const response = handleDemoFallback(`/api/v1/jobs/${jobId}`, 'GET');
  const parsed = jobStatusResponseSchema.safeParse(response);
  // The assertion the browser makes: a shape that fails here is a broken screen.
  expect(parsed.success, JSON.stringify(parsed.success ? '' : parsed.error.issues)).toBe(true);
  return parsed.data as JobStatusResponse;
}

describe('handleDemoFallback - render jobs', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it('answers GET /api/v1/jobs/:jobId with a document matching the shared schema', () => {
    seedStartedJob('job_running', 4_000);
    const job = readJob('job_running');
    expect(job.jobId).toBe('job_running');
    expect(job.name).toBe('render-video');
  });

  it('moves a started render along the pipeline timeline', () => {
    seedStartedJob('job_moving', 0);
    const first = readJob('job_moving');
    expect(first.stage).toBe('queued');
    expect(first.state).toBe('waiting');

    window.localStorage.clear();
    seedStartedJob('job_moving', 8_000);
    const later = readJob('job_moving');
    expect(later.stage).toBe('voice');
    expect(progressOf(later)).toBeGreaterThan(progressOf(first));
    expect(later.state).toBe('active');
  });

  it('finishes the render with a playable asset once the timeline is over', () => {
    seedStartedJob('job_finished', DEMO_RENDER_TOTAL_MS + 1_000);
    const job = readJob('job_finished');

    expect(job.state).toBe('completed');
    expect(job.stage).toBe('completed');
    expect(job.progress).toBe(100);

    const mp4 = job.assets.find((asset) => asset.kind === 'mp4');
    expect(mp4?.url).toBe(demoVideoUrl());
    // The demo player must point at a file the static host actually serves, not
    // at the API's asset mount - nothing answers that on Pages or Vercel.
    expect(mp4?.url).not.toContain('/api/');
  });

  it('re-runs the pipeline when a failed demo render is retried', () => {
    seedStartedJob('job_retry', DEMO_RENDER_TOTAL_MS + 1_000);
    const finished = readJob('job_retry');
    expect(finished.assets.length).toBeGreaterThan(0);

    const accepted = handleDemoFallback('/api/v1/render/job_retry/retry', 'POST', {}) as {
      jobId: string;
      state: string;
      stage: string;
    };
    expect(accepted.jobId).toBe('job_retry');
    expect(accepted.state).toBe('waiting');
    expect(accepted.stage).toBe('queued');

    const restarted = readJob('job_retry');
    expect(restarted.attemptsMade).toBe(finished.attemptsMade + 1);
    expect(restarted.assets).toEqual([]);
  });

  it('keeps the seeded showcase job finished and playable', () => {
    const job = readJob('demo-binary-search');
    expect(job.state).toBe('completed');
    expect(job.stage).toBe('completed');
    expect(job.assets.find((asset) => asset.kind === 'mp4')?.url).toBe(demoVideoUrl());
  });

  it('never reopens a job that has already finished', () => {
    const first = readJob('demo-binary-search');
    const second = readJob('demo-binary-search');
    expect(second).toEqual(first);
  });

  it('starts a new render on the timeline and hands back its job id', () => {
    const accepted = handleDemoFallback('/api/v1/render', 'POST', {
      projectId: 'proj_new',
      hook: 'Three signs your study routine is broken',
      script: [{ scene: 'Hook', text: 'Three signs your study routine is broken' }],
      cta: 'Follow for more',
    }) as { jobId: string; state: string; stage: string; progress: number };

    expect(accepted.jobId).toMatch(/^job_/);
    expect(accepted.stage).toBe('queued');
    expect(accepted.progress).toBe(0);

    const job = readJob(accepted.jobId);
    expect(job.data.hook).toBe('Three signs your study routine is broken');
    expect(job.state).toBe('waiting');
  });
});

describe('demo assets', () => {
  it('builds URLs from the app base so a subpath deployment still resolves', () => {
    expect(demoVideoUrl().startsWith('/')).toBe(true);
    expect(demoVideoUrl().endsWith(DEMO_VIDEO_PATH)).toBe(true);
    expect(demoPosterUrl()).toContain('creatordna-demo-poster.jpg');
  });
});

describe('the bundled demo render', () => {
  /**
   * The other half of the bug: a demo job whose MP4 is not actually on disk is
   * still a broken player. Nothing in the browser can assert this, so it is read
   * from the build output's source here.
   */
  it('is on disk, and is a video rather than a page', () => {
    // Vitest runs with the package as its working directory, so the asset is
    // read from the app that ships it rather than from a URL.
    const path = resolve(process.cwd(), 'public/demo/creatordna-demo.mp4');
    const bytes = readFileSync(path);

    // A real MP4 starts with an `ftyp` box; an HTML fallback page does not.
    expect(bytes.subarray(4, 8).toString('ascii')).toBe('ftyp');
    expect(bytes.byteLength).toBeGreaterThan(50_000);
  });
});
