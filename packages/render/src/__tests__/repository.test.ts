import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderCreateRequestSchema, renderJobSchema, type RenderJob } from '@creatordna/shared';
import {
  createLocalFileRenderJobRepository,
  createMemoryRenderJobRepository,
} from '../index.js';

/**
 * The job document store.
 *
 * The API and the worker both write here, so the interesting cases are the ones
 * where a second writer could clobber the first: an update that must merge
 * rather than replace, a store that starts empty, and a store that survives a
 * corrupt file.
 */

const PAYLOAD = renderCreateRequestSchema.parse({
  projectId: 'proj_1',
  hook: 'A hook',
  script: [{ scene: 'One', text: 'A line.' }],
  cta: 'Follow',
});

function job(overrides: Partial<RenderJob> = {}): RenderJob {
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

describe('the memory repository', () => {
  it('returns null for a job that was never written', async () => {
    const repository = createMemoryRenderJobRepository();
    expect(await repository.get('nope')).toBeNull();
  });

  it('saves and reads a document back', async () => {
    const repository = createMemoryRenderJobRepository();
    await repository.save(job());

    const read = await repository.get('job_1');
    expect(read?.jobId).toBe('job_1');
    expect(read?.payload.hook).toBe('A hook');
  });

  it('merges a patch rather than replacing the document', async () => {
    const repository = createMemoryRenderJobRepository();
    await repository.save(job({ assets: [{ kind: 'clip', storagePath: 'renders/u/j/clip-0.png' }] }));

    const updated = await repository.update('job_1', { stage: 'voice', progress: 70 });

    expect(updated.stage).toBe('voice');
    expect(updated.progress).toBe(70);
    // The assets the earlier stage produced are still there.
    expect(updated.assets).toHaveLength(1);
    expect(updated.payload.hook).toBe('A hook');
  });

  it('rejects an update for a job that does not exist', async () => {
    const repository = createMemoryRenderJobRepository();
    await expect(repository.update('nope', { progress: 10 })).rejects.toThrow(/does not exist/);
  });

  it('lists one creator\u2019s jobs, newest first', async () => {
    const repository = createMemoryRenderJobRepository();
    await repository.save(job({ jobId: 'a', createdAt: '2026-09-01T10:00:00.000Z' }));
    await repository.save(job({ jobId: 'b', createdAt: '2026-10-01T10:00:00.000Z' }));
    await repository.save(job({ jobId: 'c', uid: 'someone-else' }));

    const list = await repository.listByUser('creator-a', 10);
    expect(list.map((entry) => entry.jobId)).toEqual(['b', 'a']);
  });
});

describe('the local-file repository', () => {
  let dir: string;
  let path: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'creatordna-repo-'));
    path = join(dir, 'render-jobs.json');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('starts empty rather than throwing on a missing file', async () => {
    const repository = createLocalFileRenderJobRepository(path);
    expect(await repository.get('job_1')).toBeNull();
    expect(await repository.listByUser('creator-a', 10)).toEqual([]);
  });

  it('persists across two instances, which is the whole point', async () => {
    const writer = createLocalFileRenderJobRepository(path);
    await writer.save(job());

    // A second process - the worker - reading what the API wrote.
    const reader = createLocalFileRenderJobRepository(path);
    expect((await reader.get('job_1'))?.payload.hook).toBe('A hook');
  });

  it('reads an empty list from a corrupt file instead of failing every render', async () => {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path, '{ this is not json', 'utf8');

    const repository = createLocalFileRenderJobRepository(path);
    expect(await repository.get('job_1')).toBeNull();
  });

  it('drops a document that no longer matches the schema', async () => {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path, JSON.stringify([job(), { jobId: 'broken' }]), 'utf8');

    const repository = createLocalFileRenderJobRepository(path);
    // The whole file fails to parse as a list of jobs, so it reads as empty -
    // which is safer than half-applying a document the worker cannot trust.
    expect(await repository.listByUser('creator-a', 10)).toEqual([]);
  });
});
