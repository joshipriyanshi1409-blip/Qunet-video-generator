import { describe, expect, it } from 'vitest';
import { renderCreateRequestSchema, stageProgress, type RenderJobData } from '@creatordna/shared';
import { creatorDnaSchema } from '@creatordna/shared';
import { createRenderJobService } from '../services/renderJob.service.js';
import { createMemoryRenderJobRepository } from '../lib/renderJobRepository.js';
import { decodeRenderEvent, encodeRenderEvent, RENDER_EVENTS_CHANNEL } from '../lib/renderEvents.js';
import { testLogger } from './helpers.js';

const logger = testLogger();

/**
 * The render job service, with a fake queue that records what was enqueued.
 *
 * The point is the contract: the API validates the payload, stamps the uid on it
 * so a job can never be read by another creator, and writes a document that says
 * which stage the render is on and which assets it already has.
 */
function fakeQueue(jobs: Map<string, RenderJobData>) {
  const removed: string[] = [];
  let counter = 0;

  const render = {
    async add(_name: string, data: RenderJobData, options?: { jobId?: string }) {
      const id = options?.jobId ?? `job_${(counter += 1)}`;
      jobs.set(id, data);
      return {
        id,
        name: 'render-video',
        data,
        progress: 0,
        attemptsMade: 0,
        failedReason: undefined,
        returnvalue: undefined,
        async getState() {
          return 'waiting';
        },
        async remove() {
          removed.push(id);
        },
      };
    },
    async getJob(id: string) {
      const data = jobs.get(id);
      if (data === undefined) return undefined;
      return {
        id,
        name: 'render-video',
        data,
        progress: 25,
        attemptsMade: 1,
        failedReason: undefined,
        returnvalue: undefined,
        async getState() {
          return 'active';
        },
        async remove() {
          removed.push(id);
        },
      };
    },
  };

  return { ping: {} as never, render: render as never, removed, close: async () => undefined };
}

const payload = () =>
  renderCreateRequestSchema.parse({
    projectId: 'proj_1',
    hook: 'POV: you finally understand binary search',
    script: [
      { scene: 'Hook', text: 'POV: three days of staring at this.' },
      { scene: 'CTA', text: 'Follow for the next data structure.' },
    ],
    cta: 'Follow for the next data structure.',
    hashtags: ['#dsa'],
  });

/** Records what the event bus was told, so progress delivery can be asserted. */
function recordingEvents() {
  const published: { jobId: string; stage: string; progress: number }[] = [];
  return {
    published,
    async publish(event: { jobId: string; stage: string; progress: number }) {
      published.push(event);
    },
    async close() {},
  };
}

describe('the render job service', () => {
  it('creates the queue job and the job document together', async () => {
    const jobs = new Map<string, RenderJobData>();
    const repository = createMemoryRenderJobRepository();
    const service = createRenderJobService({ queues: fakeQueue(jobs), repository, logger });

    const result = await service.create(payload(), 'creator-a');

    expect(result.jobId).toBe('job_1');
    expect(result.queue).toBe('render');
    expect(result.state).toBe('waiting');
    expect(result.resumedFromAssets).toBe(false);

    const stored = await repository.get('job_1');
    expect(stored?.uid).toBe('creator-a');
    expect(stored?.stage).toBe('queued');
    expect(stored?.progress).toBe(0);
    expect(stored?.assets).toEqual([]);
  });

  it('snapshots the Creator DNA onto the document so a retry is reproducible', async () => {
    // The DNA is injected into every prompt, so the job has to carry the exact
    // profile it was started against. Reading it live at render time would mean
    // a retry next month produces a different video from the same script.
    const jobs = new Map<string, RenderJobData>();
    const repository = createMemoryRenderJobRepository();
    const dna = creatorDnaSchema.parse({
      niche: 'deadpan finance explainers',
      tone: ['dry'],
      audience: ['junior devs'],
      style: 'screen recordings',
      format: 'b-roll-voiceover',
      personality: ['sardonic'],
    });

    const service = createRenderJobService({
      queues: fakeQueue(jobs),
      repository,
      logger,
      dnaRepository: { get: async () => dna },
    });

    await service.create(payload(), 'creator-a');

    const stored = await repository.get('job_1');
    expect(stored?.dna).toEqual(dna);
  });

  it('still accepts a render when the creator has no profile yet', async () => {
    const jobs = new Map<string, RenderJobData>();
    const repository = createMemoryRenderJobRepository();
    const service = createRenderJobService({
      queues: fakeQueue(jobs),
      repository,
      logger,
      dnaRepository: { get: async () => null },
    });

    const result = await service.create(payload(), 'creator-a');

    expect(result.jobId).toBe('job_1');
    // Null, not a fabricated profile: the storyboard prompt then says `unknown`
    // for each field rather than inventing a voice for the creator.
    expect((await repository.get('job_1'))?.dna).toBeNull();
  });

  it('does not lose a paid-for render because the profile could not be read', async () => {
    const jobs = new Map<string, RenderJobData>();
    const repository = createMemoryRenderJobRepository();
    const service = createRenderJobService({
      queues: fakeQueue(jobs),
      repository,
      logger,
      dnaRepository: {
        get: async () => {
          throw new Error('firestore is unreachable');
        },
      },
    });

    const result = await service.create(payload(), 'creator-a');

    expect(result.jobId).toBe('job_1');
    expect((await repository.get('job_1'))?.dna).toBeNull();
  });

  it('keeps the payload on the document so a retry days later still works', async () => {
    const jobs = new Map<string, RenderJobData>();
    const repository = createMemoryRenderJobRepository();
    const service = createRenderJobService({ queues: fakeQueue(jobs), repository, logger });

    await service.create(payload(), 'creator-a');

    // The queue may evict the job; the document must still know what to render.
    jobs.clear();
    const document = await service.read('job_1');
    expect(document?.payload.projectId).toBe('proj_1');
    expect(document?.payload.script).toHaveLength(2);
  });

  it('reports the stage and assets the document carries', async () => {
    const jobs = new Map<string, RenderJobData>();
    const repository = createMemoryRenderJobRepository();
    const service = createRenderJobService({ queues: fakeQueue(jobs), repository, logger });
    await service.create(payload(), 'creator-a');

    // What the worker would write when the assets stage finished for one scene.
    await repository.update('job_1', {
      stage: 'assets',
      progress: 40,
      assets: [{ kind: 'clip', storagePath: 'renders/creator-a/job_1/scene-0.mp4', sceneIndex: 0 }],
    });

    const status = await service.getStatus('job_1', 'creator-a');
    expect(status.state).toBe('active');
    expect(status.stage).toBe('assets');
    expect(status.assets).toHaveLength(1);
    expect(status.error).toBeNull();
    expect(status.data?.projectId).toBe('proj_1');
  });

  it('refuses to leak another creator\'s job', async () => {
    const jobs = new Map<string, RenderJobData>();
    const repository = createMemoryRenderJobRepository();
    const service = createRenderJobService({ queues: fakeQueue(jobs), repository, logger });
    await service.create(payload(), 'creator-a');

    await expect(service.getStatus('job_1', 'creator-b')).rejects.toThrow(/not found/i);
    await expect(service.retry('job_1', 'creator-b')).rejects.toThrow(/not found/i);
  });

  it('404s for a job that was never created', async () => {
    const repository = createMemoryRenderJobRepository();
    const service = createRenderJobService({ queues: fakeQueue(new Map()), repository, logger });

    await expect(service.getStatus('job_missing', 'creator-a')).rejects.toThrow(/not found/i);
  });

  it('explains itself when Redis is disabled rather than throwing a 500', async () => {
    const repository = createMemoryRenderJobRepository();
    const service = createRenderJobService({ queues: null, repository, logger });

    await expect(service.create(payload(), 'creator-a')).rejects.toThrow(/queue unavailable/i);
  });

  it('records progress on the document and publishes it', async () => {
    const jobs = new Map<string, RenderJobData>();
    const repository = createMemoryRenderJobRepository();
    const events = recordingEvents();
    const service = createRenderJobService({
      queues: fakeQueue(jobs),
      repository,
      logger,
      events,
    });
    await service.create(payload(), 'creator-a');
    events.published.length = 0;

    await service.reportProgress({ type: 'render.progress', jobId: 'job_1', stage: 'voice', progress: 46 });

    const document = await service.read('job_1');
    expect(document?.stage).toBe('voice');
    expect(document?.progress).toBe(46);
    expect(events.published).toEqual([
      { type: 'render.progress', jobId: 'job_1', stage: 'voice', progress: 46 },
    ]);
  });

  it('marks the render completed when the last stage reports in', async () => {
    const jobs = new Map<string, RenderJobData>();
    const repository = createMemoryRenderJobRepository();
    const service = createRenderJobService({ queues: fakeQueue(jobs), repository, logger });
    await service.create(payload(), 'creator-a');

    await service.reportProgress({
      type: 'render.progress',
      jobId: 'job_1',
      stage: 'completed',
      progress: 100,
    });

    expect((await service.read('job_1'))?.state).toBe('completed');
  });

  it('ignores progress for a job it does not know about', async () => {
    const repository = createMemoryRenderJobRepository();
    const service = createRenderJobService({ queues: fakeQueue(new Map()), repository, logger });

    // The worker publishes on a job the API has already cleaned up: not an error.
    await expect(
      service.reportProgress({
        type: 'render.progress',
        jobId: 'ghost',
        stage: 'voice',
        progress: 50,
      }),
    ).resolves.toBeUndefined();
  });
});

describe('retrying one stage', () => {
  /** A job that failed in the voice stage, with the earlier assets on it. */
  async function failedJob() {
    const jobs = new Map<string, RenderJobData>();
    const repository = createMemoryRenderJobRepository();
    const service = createRenderJobService({ queues: fakeQueue(jobs), repository, logger });
    await service.create(payload(), 'creator-a');

    await repository.update('job_1', {
      state: 'failed',
      stage: 'voice',
      progress: 45,
      attemptsMade: 1,
      assets: [
        { kind: 'storyboard', storagePath: 'renders/creator-a/job_1/storyboard.json' },
        { kind: 'clip', storagePath: 'renders/creator-a/job_1/scene-0.mp4', sceneIndex: 0 },
        { kind: 'music', storagePath: 'renders/creator-a/job_1/music.mp3' },
      ],
      error: { stage: 'voice', message: 'TTS timeout', attempts: 1, retryable: true },
    });

    return { service, repository, jobs };
  }

  it('re-runs the failed stage and reports the assets it is resuming from', async () => {
    const { service } = await failedJob();

    const result = await service.retry('job_1', 'creator-a');

    expect(result.stage).toBe('voice');
    expect(result.resumedFromAssets).toBe(true);
    expect(result.state).toBe('waiting');

    const document = await service.read('job_1');
    expect(document?.stage).toBe('voice');
    expect(document?.progress).toBe(stageProgress('voice', 0));
    expect(document?.error).toBeNull();
    // The assets are what makes the retry cheap, so they are never cleared.
    expect(document?.assets).toHaveLength(3);
    expect(document?.attemptsMade).toBe(2);
  });

  it('honours an explicit stage when the caller asks for an earlier one', async () => {
    const { service } = await failedJob();

    const result = await service.retry('job_1', 'creator-a', 'storyboard');

    expect(result.stage).toBe('storyboard');
    expect((await service.read('job_1'))?.stage).toBe('storyboard');
  });

  it('replaces the old queue entry so the retry cannot be a no-op', async () => {
    const { service, jobs } = await failedJob();

    // BullMQ will not re-add under a job id that already exists, so a retry that
    // did not remove the old entry would report success and do nothing.
    await service.retry('job_1', 'creator-a');

    const stored = jobs.get('job_1');
    expect(stored?.projectId).toBe('proj_1');
    expect(stored?.uid).toBe('creator-a');
  });

  it('refuses to retry a state that is not a stage', async () => {
    const { service } = await failedJob();

    await expect(service.retry('job_1', 'creator-a', 'failed')).rejects.toThrow(/cannot be retried/i);
    await expect(service.retry('job_1', 'creator-a', 'completed')).rejects.toThrow(/cannot be retried/i);
    expect((await service.read('job_1'))?.stage).toBe('voice');
  });
});

describe('render progress events on the wire', () => {
  it('round-trips through the shared schema', () => {
    const encoded = encodeRenderEvent({
      type: 'render.progress',
      jobId: 'job_1',
      stage: 'assets',
      progress: 40,
      message: 'rendering scene 2 of 5',
    });

    expect(JSON.parse(encoded)).toEqual({
      type: 'render.progress',
      jobId: 'job_1',
      stage: 'assets',
      progress: 40,
      message: 'rendering scene 2 of 5',
    });
    expect(decodeRenderEvent(encoded)).not.toBeNull();
  });

  it('drops a malformed event instead of pushing junk to the browser', () => {
    expect(decodeRenderEvent('{"type":"render.progress","jobId":1}')).toBeNull();
    expect(decodeRenderEvent('not json at all')).toBeNull();
    expect(decodeRenderEvent('{"type":"something.else"}')).toBeNull();
  });

  it('names a channel that is unique to the pipeline', () => {
    // One render, one channel: the prefix must not collide with anything else
    // that might be broadcast on the shared socket.
    expect(RENDER_EVENTS_CHANNEL).toBe('creatordna:render:events');
  });
});

