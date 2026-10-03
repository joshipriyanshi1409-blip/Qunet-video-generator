import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLogger } from '@creatordna/shared/logger';
import { renderJobDataSchema, renderJobSchema, type RenderJob } from '@creatordna/shared';
import {
  createMockComposer,
  createMockRenderAi,
  createMemoryAssetStore,
  createMemoryRenderJobRepository,
} from '@creatordna/render';
import { createRenderProcessor } from '../jobs/render.job.js';

/**
 * The render processor.
 *
 * The one behaviour worth guarding is the retry contract: **a stage failure must
 * come back as a result, not a throw.** BullMQ re-runs a job whose processor
 * throws, and for a render that means regenerating clips the creator already paid
 * for. Everything else here is the pipeline's, tested in `packages/render`.
 */

const logger = createLogger({ level: 'silent' });

const DATA = renderJobDataSchema.parse({
  projectId: 'proj_1',
  hook: 'POV: binary search finally clicks',
  script: [
    { scene: 'The bug', text: 'I wrote the same loop nine times.' },
    { scene: 'The fix', text: 'Then I drew the array on paper.' },
  ],
  cta: 'Follow for part two',
  uid: 'creator-a',
});

/** A BullMQ job, as far as the processor is concerned. */
function fakeJob(id: string, attemptsMade = 0) {
  const progress: number[] = [];
  return {
    id,
    attemptsMade,
    data: DATA,
    updateProgress: async (value: number) => {
      progress.push(value);
    },
    progress,
  };
}

function jobDocument(overrides: Partial<RenderJob> = {}): RenderJob {
  return renderJobSchema.parse({
    jobId: 'job_1',
    uid: 'creator-a',
    queue: 'render',
    state: 'waiting',
    stage: 'queued',
    progress: 0,
    assets: [],
    error: null,
    attemptsMade: 0,
    payload: { ...DATA },
    createdAt: '2026-10-01T10:00:00.000Z',
    ...overrides,
  });
}

describe('createRenderProcessor', () => {
  let workRoot: string;

  beforeEach(async () => {
    workRoot = await mkdtemp(join(tmpdir(), 'creatordna-worker-'));
  });

  afterEach(async () => {
    await rm(workRoot, { recursive: true, force: true });
  });

  it('runs the pipeline and reports completion', async () => {
    const repository = createMemoryRenderJobRepository();
    await repository.save(jobDocument());

    const processor = createRenderProcessor({
      repository,
      store: createMemoryAssetStore(),
      ai: createMockRenderAi(),
      composer: createMockComposer(),
      events: null,
      workRoot,
      width: 1080,
      height: 1920,
      logger,
    });

    const job = fakeJob('job_1');
    const result = await processor(job as never);

    expect(result.stage).toBe('completed');
    expect(result.outputPath).toBe('renders/creator-a/job_1/mp4.mp4');
    // Progress is reported on the queue entry too, so a BullMQ dashboard and the
    // job document never disagree.
    expect(job.progress.at(-1)).toBe(100);
  });

  it('returns a failure result rather than throwing, so BullMQ does not re-run it', async () => {
    const repository = createMemoryRenderJobRepository();
    await repository.save(jobDocument());

    const processor = createRenderProcessor({
      repository,
      store: createMemoryAssetStore(),
      ai: createMockRenderAi(),
      composer: createMockComposer({
        write: async () => {
          throw new Error('encoder exploded');
        },
      }),
      events: null,
      workRoot,
      width: 1080,
      height: 1920,
      logger,
    });

    const job = fakeJob('job_1');
    // The important part is that this resolves at all.
    const result = await processor(job as never);

    expect(result.stage).toBe('failed');
    expect(result.message).toContain('encoder exploded');
    expect(job.progress.at(-1)).toBe(0);

    // And the document records which stage, so the creator's retry resumes there.
    const job1 = await repository.get('job_1');
    expect(job1?.error?.stage).toBe('compose');
    expect(job1?.state).toBe('failed');
  });

  it('names the asset it could not read back rather than failing cryptically', async () => {
    // A voice asset on the job whose bytes are gone from the store is the case a
    // zero-byte fallback would turn into an ffmpeg decode error.
    const repository = createMemoryRenderJobRepository();
    const store = createMemoryAssetStore();
    await repository.save(jobDocument());

    // Run once so the voice asset is recorded, then rewind to the compose stage
    // and drop its bytes behind the pipeline's back.
    const deps = {
      repository,
      store,
      ai: createMockRenderAi(),
      composer: createMockComposer(),
      events: null,
      workRoot,
      width: 1080,
      height: 1920,
      logger,
    };
    await createRenderProcessor(deps)(fakeJob('job_1') as never);
    await repository.update('job_1', { stage: 'compose', state: 'waiting' });

    const originalRead = store.read.bind(store);
    store.read = async (storagePath: string) =>
      storagePath.includes('voice') ? null : originalRead(storagePath);

    const result = await createRenderProcessor(deps)(fakeJob('job_1') as never);

    expect(result.stage).toBe('failed');
    expect(result.message).toContain('voice-over');
    expect(result.message).toContain('could not be read back from storage');
  });

  it('does nothing at all when the job already finished', async () => {
    // BullMQ re-queues a job whose processor threw after the work succeeded.
    const repository = createMemoryRenderJobRepository();
    const store = createMemoryAssetStore();
    await repository.save(jobDocument());

    const deps = {
      repository,
      store,
      ai: createMockRenderAi(),
      composer: createMockComposer(),
      events: null,
      workRoot,
      width: 1080,
      height: 1920,
      logger,
    };
    await createRenderProcessor(deps)(fakeJob('job_1') as never);
    const writesAfterFirstRun = store.written.length;

    const again = await createRenderProcessor(deps)(fakeJob('job_1') as never);

    expect(again.stage).toBe('completed');
    // Not one asset was regenerated.
    expect(store.written).toHaveLength(writesAfterFirstRun);
  });

  it('rejects job data that does not match the schema', async () => {
    const processor = createRenderProcessor({
      repository: createMemoryRenderJobRepository(),
      store: createMemoryAssetStore(),
      ai: createMockRenderAi(),
      composer: createMockComposer(),
      events: null,
      workRoot,
      width: 1080,
      height: 1920,
      logger,
    });

    const broken = fakeJob('job_1');
    broken.data = { projectId: 'proj_1' } as never;

    await expect(processor(broken as never)).rejects.toThrow();
  });
});
