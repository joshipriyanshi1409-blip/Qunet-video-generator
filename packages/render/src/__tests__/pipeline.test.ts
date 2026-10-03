import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  creatorDnaSchema,
  renderCreateRequestSchema,
  renderJobSchema,
  type RenderAsset,
  type RenderJob,
  type RenderProgressEvent,
} from '@creatordna/shared';
import { createLogger } from '@creatordna/shared/logger';
import {
  StageFailure,
  createMockComposer,
  createMockRenderAi,
  createMemoryAssetStore,
  createMemoryRenderJobRepository,
  mergeAssets,
  runRenderPipeline,
  type PipelineDeps,
} from '../index.js';

/**
 * The pipeline, end to end.
 *
 * Everything is in memory except the scratch directory, so these tests run in
 * milliseconds and still exercise the thing that matters: a render runs its
 * stages, records its assets, publishes its progress, and a **retry resumes from
 * the failed stage without redoing the ones before it**.
 */

const logger = createLogger({ level: 'silent' });

const PAYLOAD = renderCreateRequestSchema.parse({
  projectId: 'proj_1',
  hook: 'POV: binary search finally clicks',
  script: [
    { scene: 'The bug', text: 'I wrote the same loop nine times.' },
    { scene: 'The fix', text: 'Then I drew the array on paper.' },
    { scene: 'The takeaway', text: 'Draw it before you code it.' },
  ],
  cta: 'Follow for part two',
  caption: 'Three days, one bug, zero progress.',
  hashtags: ['#dsa'],
});

function jobFixture(overrides: Partial<RenderJob> = {}): RenderJob {
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
    payload: { ...PAYLOAD, uid: 'creator-a' },
    createdAt: '2026-10-01T10:00:00.000Z',
    ...overrides,
  });
}

interface Harness {
  deps: PipelineDeps;
  repository: ReturnType<typeof createMemoryRenderJobRepository>;
  store: ReturnType<typeof createMemoryAssetStore>;
  events: RenderProgressEvent[];
  workRoot: string;
}

/**
 * Builds a pipeline over an optional shared store and repository.
 *
 * Sharing them is the realistic case and the point of the resume tests: in
 * production the asset store is Firebase Storage or a shared directory, so the
 * bytes an earlier attempt wrote are still there when the retry runs. A retry
 * against a *fresh* store would fail, which is exactly what the test is checking
 * does not happen.
 */
async function harness(
  options: {
    failCompose?: boolean;
    workRoot?: string;
    repository?: ReturnType<typeof createMemoryRenderJobRepository>;
    store?: ReturnType<typeof createMemoryAssetStore>;
  } = {},
): Promise<Harness> {
  const workRoot = options.workRoot ?? (await mkdtemp(join(tmpdir(), 'creatordna-render-')));
  const repository = options.repository ?? createMemoryRenderJobRepository();
  const store = options.store ?? createMemoryAssetStore();
  const events: RenderProgressEvent[] = [];

  const composer = options.failCompose === true
    ? createMockComposer({
        write: async () => {
          throw new Error('encoder exploded');
        },
      })
    : createMockComposer();

  const deps: PipelineDeps = {
    repository,
    store,
    ai: createMockRenderAi(),
    composer,
    logger,
    workRoot,
    events: {
      publish: async (event) => {
        events.push(event as RenderProgressEvent);
      },
      close: async () => undefined,
    },
  };

  return { deps, repository, store, events, workRoot };
}

describe('runRenderPipeline', () => {
  let workRoots: string[] = [];

  beforeEach(() => {
    workRoots = [];
  });

  afterEach(async () => {
    await Promise.all(workRoots.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('runs every stage and records an asset for each one that produces one', async () => {
    const h = await harness();
    workRoots.push(h.workRoot);
    await h.repository.save(jobFixture());

    const result = await runRenderPipeline(h.deps, 'job_1');

    expect(result.stage).toBe('completed');
    expect(result.ran).toEqual([
      'script',
      'storyboard',
      'assets',
      'voice',
      'music',
      'captions',
      'compose',
      'qc',
    ]);

    const kinds = h.store.written.map((asset) => asset.kind);
    expect(kinds).toContain('storyboard');
    expect(kinds).toContain('clip');
    expect(kinds).toContain('thumbnail');
    expect(kinds).toContain('voice');
    expect(kinds).toContain('music');
    expect(kinds).toContain('captions');
    expect(kinds).toContain('mp4');
  });

  it('hands the DNA snapshot on the job to the storyboard builder', async () => {
    // The DNA is the product. It is snapshotted onto the document at accept time
    // so a retry reproduces the same video, and this is the test that proves the
    // snapshot actually reaches the prompt rather than being carried and ignored.
    const h = await harness();
    workRoots.push(h.workRoot);
    // Parsed through the schema, exactly as the API stores it: the defaults are
    // part of the profile, and a hand-written literal would drift from them.
    const dna = creatorDnaSchema.parse({
      dnaVersion: 4,
      updatedAt: '2026-02-02T00:00:00.000Z',
      niche: 'deadpan finance explainers',
      tone: ['dry'],
      audience: ['junior devs'],
      style: 'screen recordings',
      format: 'b-roll-voiceover',
      personality: ['sardonic'],
    });
    await h.repository.save(jobFixture({ dna }));

    const seen: unknown[] = [];
    const deps: PipelineDeps = {
      ...h.deps,
      ai: {
        ...createMockRenderAi(),
        buildStoryboard: (payload, handedDna) => {
          seen.push(handedDna);
          return createMockRenderAi().buildStoryboard(payload, handedDna);
        },
      },
    };

    await runRenderPipeline(deps, 'job_1');

    // Exactly what the document holds - schema defaults and all - is what the
    // storyboard builder was handed. Comparing against the *stored* profile
    // rather than the literal above is the point: the defaults are part of it.
    const stored = await h.repository.get('job_1');
    expect(seen).toEqual([stored?.dna]);
    expect(stored?.dna?.niche).toBe('deadpan finance explainers');
  });

  it('passes null rather than inventing a profile when the job has none', async () => {
    const h = await harness();
    workRoots.push(h.workRoot);
    await h.repository.save(jobFixture({ dna: null }));

    const seen: unknown[] = [];
    const deps: PipelineDeps = {
      ...h.deps,
      ai: {
        ...createMockRenderAi(),
        buildStoryboard: (payload, handedDna) => {
          seen.push(handedDna);
          return createMockRenderAi().buildStoryboard(payload, handedDna);
        },
      },
    };

    await runRenderPipeline(deps, 'job_1');

    expect(seen).toEqual([null]);
  });

  it('times the captions from the recorded voice-over, not from the plan', async () => {
    // The bug this closes: the captions stage used the storyboard's declared
    // durations, which are exact for a mock voice-over (synthesised to exactly
    // those lengths) and wrong for a real one, where the model speaks at its own
    // pace. The stage now hands the recorded audio to the AI and uses what comes
    // back.
    const h = await harness();
    workRoots.push(h.workRoot);
    await h.repository.save(jobFixture());

    const aligned = [
      { lineIndex: 0, startSeconds: 0.25, endSeconds: 6.4 },
      { lineIndex: 1, startSeconds: 6.7, endSeconds: 12.1 },
      { lineIndex: 2, startSeconds: 12.4, endSeconds: 18.9 },
    ];
    const alignCaptions = vi.fn().mockResolvedValue(aligned);

    const deps: PipelineDeps = {
      ...h.deps,
      ai: { ...createMockRenderAi(), alignCaptions },
    };

    await runRenderPipeline(deps, 'job_1');

    expect(alignCaptions).toHaveBeenCalledTimes(1);
    const request = alignCaptions.mock.calls[0]?.[0] as {
      voice: Buffer;
      lines: { narration: string }[];
      durationSeconds: number;
    };
    // The voice stage ran first, so there are real bytes to align against.
    expect(request.voice.length).toBeGreaterThan(44);
    expect(request.lines.map((line) => line.narration)).toEqual([
      'I wrote the same loop nine times. POV: binary search finally clicks',
      'Then I drew the array on paper.',
      'Draw it before you code it.',
    ]);
    expect(request.durationSeconds).toBe(30);

    // And the cues on disk are the ones the aligner returned, not the plan.
    const captions = h.store.written.find((asset) => asset.kind === 'captions');
    expect(captions).toBeDefined();
    // `read` returns null for a path that was never written, so guard it.
    const vtt = (await h.store.read(captions!.storagePath))?.toString('utf8') ?? '';
    expect(vtt).toContain('00:00:00.250 --> 00:00:06.400');
    expect(vtt).toContain('00:00:12.400 --> 00:00:18.900');
    // The plan would have produced 0-10 / 10-20 / 20-30.
    expect(vtt).not.toContain('00:00:10.000 --> 00:00:20.000');
  });

  it('still times captions from the plan when the voice-over cannot be read', async () => {
    // A silent short is a QC warning, not a reason to fail the render - so the
    // stage falls back to the storyboard's own durations rather than throwing,
    // and never sends an empty audio file to a model.
    const h = await harness();
    workRoots.push(h.workRoot);
    await h.repository.save(jobFixture());

    const alignCaptions = vi.fn();
    const deps: PipelineDeps = {
      ...h.deps,
      ai: { ...createMockRenderAi(), alignCaptions },
    };

    // The captions stage runs before compose, so the first read of the voice asset
    // is the captions stage's. Give it nothing, and let compose have the real
    // bytes - otherwise this would be testing a failed compose, not a fallback.
    const originalRead = h.store.read.bind(h.store);
    let voiceReads = 0;
    h.store.read = async (storagePath: string) => {
      if (storagePath.includes('voice') === false) return originalRead(storagePath);
      voiceReads += 1;
      return voiceReads === 1 ? null : originalRead(storagePath);
    };

    const result = await runRenderPipeline(deps, 'job_1');

    expect(result.stage).toBe('completed');
    expect(alignCaptions).not.toHaveBeenCalled();

    const captions = h.store.written.find((asset) => asset.kind === 'captions');
    expect(captions).toBeDefined();
    // `read` returns null for a path that was never written, so guard it.
    const vtt = (await h.store.read(captions!.storagePath))?.toString('utf8') ?? '';
    // The plan: three scenes of 10s each, so 0-10, 10-20, 20-30.
    expect(vtt).toContain('00:00:00.000 --> 00:00:10.000');
    expect(vtt).toContain('00:00:10.000 --> 00:00:20.000');
    expect(vtt).toContain('00:00:20.000 --> 00:00:30.000');
  });

  it('writes the finished state onto the document', async () => {
    const h = await harness();
    workRoots.push(h.workRoot);
    await h.repository.save(jobFixture());

    await runRenderPipeline(h.deps, 'job_1');

    const job = await h.repository.get('job_1');
    expect(job?.state).toBe('completed');
    expect(job?.stage).toBe('completed');
    expect(job?.progress).toBe(100);
    expect(job?.error).toBeNull();
    expect(job?.assets.some((asset) => asset.kind === 'mp4')).toBe(true);
  });

  it('publishes progress that never goes backwards', async () => {
    const h = await harness();
    workRoots.push(h.workRoot);
    await h.repository.save(jobFixture());

    await runRenderPipeline(h.deps, 'job_1');

    const progress = h.events.map((event) => event.progress);
    expect(progress.length).toBeGreaterThan(8);
    expect(progress[progress.length - 1]).toBe(100);
    for (let index = 1; index < progress.length; index += 1) {
      expect(progress[index] ?? 0).toBeGreaterThanOrEqual(progress[index - 1] ?? 0);
    }
  });

  it('produces a real WAV whose duration matches the storyboard', async () => {
    const h = await harness();
    workRoots.push(h.workRoot);
    await h.repository.save(jobFixture());

    await runRenderPipeline(h.deps, 'job_1');

    const voice = h.store.written.find((asset) => asset.kind === 'voice');
    expect(voice).toBeDefined();
    const bytes = h.store.bytesFor(voice?.storagePath ?? '');
    // Three scenes at 10s each, from the default 30s target.
    expect(bytes?.subarray(24, 28).readUInt32LE(0)).toBe(16_000);
    expect(bytes?.subarray(40, 44).readUInt32LE(0)).toBe(30 * 16_000 * 2);
  });

  it('writes a captions file with one cue per scene', async () => {
    const h = await harness();
    workRoots.push(h.workRoot);
    await h.repository.save(jobFixture());

    await runRenderPipeline(h.deps, 'job_1');

    const captions = h.store.written.find((asset) => asset.kind === 'captions');
    const text = h.store.bytesFor(captions?.storagePath ?? '')?.toString('utf8') ?? '';
    expect(text.startsWith('WEBVTT')).toBe(true);
    expect(text.split('\n').filter((line) => line.includes(' --> '))).toHaveLength(3);
    expect(text).toContain('I wrote the same loop nine times.');
  });

  it('cleans up its scratch directory when it finishes', async () => {
    const h = await harness();
    workRoots.push(h.workRoot);
    await h.repository.save(jobFixture());

    await runRenderPipeline(h.deps, 'job_1');

    const { stat } = await import('node:fs/promises');
    await expect(stat(join(h.workRoot, 'job_1'))).rejects.toThrow();
  });

  it('reports a failed stage on the document rather than throwing', async () => {
    const h = await harness({ failCompose: true });
    workRoots.push(h.workRoot);
    await h.repository.save(jobFixture());

    const result = await runRenderPipeline(h.deps, 'job_1');

    expect(result.stage).toBe('failed');
    expect(result.message).toContain('encoder exploded');

    const job = await h.repository.get('job_1');
    expect(job?.state).toBe('failed');
    expect(job?.error?.stage).toBe('compose');
    expect(job?.error?.retryable).toBe(true);
    // The stages before compose still produced their assets.
    expect(job?.assets.some((asset) => asset.kind === 'clip')).toBe(true);
    expect(job?.assets.some((asset) => asset.kind === 'mp4')).toBe(false);
  });

  it('resumes from the failed stage and reuses every asset before it', async () => {
    // One store and one repository across both attempts, which is what a real
    // deployment has: the assets an attempt wrote are still readable.
    const shared = {
      repository: createMemoryRenderJobRepository(),
      store: createMemoryAssetStore(),
    };
    const first = await harness({
      failCompose: true,
      repository: shared.repository,
      store: shared.store,
    });
    workRoots.push(first.workRoot);
    await shared.repository.save(jobFixture());

    await runRenderPipeline(first.deps, 'job_1');
    const afterFailure = await shared.repository.get('job_1');
    const clipsAfterFailure = shared.store.written.filter((asset) => asset.kind === 'clip').length;
    expect(clipsAfterFailure).toBe(3);

    // The API re-queues the job with `stage` set to the stage that failed.
    await shared.repository.update('job_1', { stage: 'compose', state: 'waiting', error: null });

    const retry = await harness({ repository: shared.repository, store: shared.store });
    workRoots.push(retry.workRoot);

    const result = await runRenderPipeline(retry.deps, 'job_1');

    expect(result.stage).toBe('completed');
    // Only compose and qc ran. Not one clip was regenerated.
    expect(result.ran).toEqual(['compose', 'qc']);
    expect(shared.store.written.filter((asset) => asset.kind === 'clip')).toHaveLength(3);

    const job = await shared.repository.get('job_1');
    expect(job?.state).toBe('completed');
    // Exactly one asset more than the failed attempt had: the MP4.
    expect(job?.assets).toHaveLength((afterFailure?.assets.length ?? 0) + 1);
  });

  it('re-runs the stage a retry names, and skips the ones after it that already have assets', async () => {
    const shared = {
      repository: createMemoryRenderJobRepository(),
      store: createMemoryAssetStore(),
    };
    const first = await harness({
      failCompose: true,
      repository: shared.repository,
      store: shared.store,
    });
    workRoots.push(first.workRoot);
    await shared.repository.save(jobFixture());
    await runRenderPipeline(first.deps, 'job_1');

    const before = await shared.repository.get('job_1');
    const clipsBefore = shared.store.written.filter((asset) => asset.kind === 'clip').length;
    expect(clipsBefore).toBe(3);

    // A retry that lands back at `voice`, with music, captions, clips and the
    // storyboard all already stored from the first attempt.
    await shared.repository.update('job_1', { stage: 'voice', state: 'waiting', error: null });

    const resumed = await harness({ repository: shared.repository, store: shared.store });
    workRoots.push(resumed.workRoot);

    const result = await runRenderPipeline(resumed.deps, 'job_1');

    expect(result.stage).toBe('completed');
    // The named stage always runs - it is the one that was reported as broken.
    expect(result.ran).toEqual(['voice', 'compose', 'qc']);
    // Everything after it that already has an asset is skipped.
    expect(result.skipped).toEqual(['music', 'captions']);
    // Not one clip was regenerated.
    expect(shared.store.written.filter((asset) => asset.kind === 'clip')).toHaveLength(3);
    expect(before?.assets.filter((asset) => asset.kind === 'clip')).toHaveLength(3);
  });

  it('never re-runs a job that already finished', async () => {
    // BullMQ re-queues a job whose processor threw *after* the work succeeded.
    // Without a guard that regenerates every asset the creator already has.
    const h = await harness();
    workRoots.push(h.workRoot);
    await h.repository.save(jobFixture());

    await runRenderPipeline(h.deps, 'job_1');
    const writesAfterFirstRun = h.store.written.length;

    const again = await runRenderPipeline(h.deps, 'job_1');

    expect(again.stage).toBe('completed');
    expect(again.ran).toEqual([]);
    expect(h.store.written).toHaveLength(writesAfterFirstRun);
  });

  it('resumes from the assets when the recorded stage is not one of the eight', async () => {
    // A job that failed before any stage ran, or one written by an older build:
    // `stage` is `failed` or something unknown, so the resume point has to come
    // from what is already stored rather than restarting from zero.
    const h = await harness();
    workRoots.push(h.workRoot);
    await h.repository.save(jobFixture({ stage: 'failed', state: 'failed', assets: [] }));

    const result = await runRenderPipeline(h.deps, 'job_1');

    expect(result.stage).toBe('completed');
    // Everything ran, because nothing was stored yet.
    expect(result.ran).toHaveLength(8);
  });

  it('resumes mid-pipeline when the recorded stage is unknown but assets exist', async () => {
    const shared = {
      repository: createMemoryRenderJobRepository(),
      store: createMemoryAssetStore(),
    };
    const first = await harness({ failCompose: true, repository: shared.repository, store: shared.store });
    workRoots.push(first.workRoot);
    await shared.repository.save(jobFixture());
    await runRenderPipeline(first.deps, 'job_1');

    // Wipe the recorded stage, as an older build or a partial write might.
    await shared.repository.update('job_1', { stage: 'queued' as never, state: 'waiting' });

    const resumed = await harness({ repository: shared.repository, store: shared.store });
    workRoots.push(resumed.workRoot);

    const result = await runRenderPipeline(resumed.deps, 'job_1');

    expect(result.stage).toBe('completed');
    // The clips and the storyboard were kept, so only compose and qc were
    // needed. `script` re-runs because it produces no asset - it is a pure
    // validation, and re-running it costs nothing.
    expect(result.ran).toEqual(['script', 'compose', 'qc']);
    expect(shared.store.written.filter((asset) => asset.kind === 'clip')).toHaveLength(3);
  });

  it('answers honestly when there is no job document', async () => {
    const h = await harness();
    workRoots.push(h.workRoot);

    const result = await runRenderPipeline(h.deps, 'job_missing');

    expect(result.stage).toBe('failed');
    expect(result.message).toContain('No job document');
  });

  it('replaces an asset by kind and scene rather than accumulating duplicates', async () => {
    const merged = mergeAssets(
      [clipAsset(0, 'first')],
      [clipAsset(0, 'second'), clipAsset(1, 'other-scene')],
    );

    expect(merged.filter((asset) => asset.sceneIndex === 0)).toHaveLength(1);
    expect(merged.find((asset) => asset.sceneIndex === 0)?.storagePath).toBe('renders/u/j/second');
    expect(merged).toHaveLength(2);
  });

  it('marks a cost-limit failure as not retryable, because it will fail again', async () => {
    const h = await harness();
    workRoots.push(h.workRoot);
    // Twelve scenes, over the eight-scene cap.
    await h.repository.save(
      jobFixture({
        payload: {
          ...PAYLOAD,
          uid: 'creator-a',
          script: Array.from({ length: 12 }, (_, index) => ({
            scene: `Scene ${index + 1}`,
            text: 'A line long enough to pass validation.',
          })),
        },
      }),
    );

    const result = await runRenderPipeline(h.deps, 'job_1');

    expect(result.stage).toBe('failed');
    const job = await h.repository.get('job_1');
    expect(job?.error?.stage).toBe('script');
    expect(job?.error?.retryable).toBe(false);
  });

  it('keeps the original error on a StageFailure, and defaults to retryable', () => {
    const cause = new Error('socket closed');
    const failure = new StageFailure('voice', 'the voice stage failed', { cause });
    expect(failure.stage).toBe('voice');
    expect(failure.cause).toBe(cause);
    expect(failure.retryable).toBe(true);
  });
});

/** Small helper so the merge test reads as data rather than as plumbing. */
function clipAsset(sceneIndex: number, marker: string): RenderAsset {
  return { kind: 'clip', storagePath: `renders/u/j/${marker}`, sceneIndex };
}
