import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  RENDER_JOB_COLLECTION,
  assetFileName,
  assetStoragePath,
  createLocalDiskAssetStore,
  createMemoryAssetStore,
  defaultLocalRenderJobPath,
} from '../index.js';

/**
 * The store and the asset paths.
 *
 * These are the two places where the API and the worker have to agree exactly:
 * one JSON file (or one Firestore collection) and one path layout. A test that
 * seeds a job through one implementation and reads it through the other is the
 * only thing that catches a disagreement before a render silently vanishes.
 */

describe('asset paths', () => {
  it('names a per-scene clip with its index and a plain asset without one', () => {
    expect(assetFileName('clip', 'png', 2)).toBe('clip-2.png');
    expect(assetFileName('voice', 'wav')).toBe('voice.wav');
    expect(assetFileName('mp4', 'mp4')).toBe('mp4.mp4');
  });

  it('puts every asset for a job under one prefix', () => {
    expect(assetStoragePath('creator-a', 'job_1', 'voice.wav')).toBe(
      'renders/creator-a/job_1/voice.wav',
    );
  });

  it('keeps the Firestore collection name in one place', () => {
    expect(RENDER_JOB_COLLECTION).toBe('renderJobs');
  });

  it('defaults the local store next to the other dev stores', () => {
    expect(defaultLocalRenderJobPath('/tmp/.data')).toBe('/tmp/.data/render-jobs.json');
  });
});

describe('the local-disk asset store', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'creatordna-assets-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('writes real bytes and records a readable path', async () => {
    const store = createLocalDiskAssetStore({ root });
    const asset = await store.put({
      uid: 'creator-a',
      jobId: 'job_1',
      kind: 'voice',
      extension: 'wav',
      mimeType: 'audio/wav',
      body: Buffer.from('RIFFfake'),
    });

    expect(asset.storagePath).toBe('renders/creator-a/job_1/voice.wav');
    expect(asset.bytes).toBe(8);
    expect(asset.mimeType).toBe('audio/wav');
    expect(await store.read(asset.storagePath)).toEqual(Buffer.from('RIFFfake'));
  });

  it('records a URL only when a base URL is configured', async () => {
    const silent = createLocalDiskAssetStore({ root });
    const noUrl = await silent.put({
      uid: 'u',
      jobId: 'j',
      kind: 'mp4',
      extension: 'mp4',
      mimeType: 'video/mp4',
      body: Buffer.alloc(4),
    });
    expect(noUrl.url).toBeUndefined();

    const served = createLocalDiskAssetStore({ root, publicBaseUrl: '/api/v1/render-assets/' });
    const withUrl = await served.put({
      uid: 'u',
      jobId: 'j',
      kind: 'mp4',
      extension: 'mp4',
      mimeType: 'video/mp4',
      body: Buffer.alloc(4),
    });
    expect(withUrl.url).toBe('/api/v1/render-assets/renders/u/j/mp4.mp4');
  });

  it('refuses to write outside its root', async () => {
    const store = createLocalDiskAssetStore({ root });
    await expect(
      store.put({
        uid: '../../escape',
        jobId: 'job_1',
        kind: 'clip',
        extension: 'png',
        mimeType: 'image/png',
        body: Buffer.alloc(1),
      }),
    ).rejects.toThrow(/outside the asset root/);
  });

  it('returns null for a path that was never written', async () => {
    const store = createLocalDiskAssetStore({ root });
    expect(await store.read('renders/u/j/nope.wav')).toBeNull();
  });
});

describe('the memory asset store', () => {
  it('round-trips what it was given, in write order', async () => {
    const store = createMemoryAssetStore();
    await store.put({
      uid: 'u',
      jobId: 'j',
      kind: 'storyboard',
      extension: 'json',
      mimeType: 'application/json',
      body: Buffer.from('{}'),
    });
    await store.put({
      uid: 'u',
      jobId: 'j',
      kind: 'clip',
      extension: 'png',
      mimeType: 'image/png',
      body: Buffer.from('png'),
      sceneIndex: 0,
    });

    expect(store.written.map((asset) => asset.kind)).toEqual(['storyboard', 'clip']);
    expect(store.written[1]?.sceneIndex).toBe(0);
    expect(await store.read(store.written[0]?.storagePath ?? '')).toEqual(Buffer.from('{}'));
  });

  it('overwrites rather than duplicating when a stage runs twice', async () => {
    const store = createMemoryAssetStore();
    const input = {
      uid: 'u',
      jobId: 'j',
      kind: 'clip' as const,
      extension: 'png',
      mimeType: 'image/png',
      sceneIndex: 0,
    };

    await store.put({ ...input, body: Buffer.from('first') });
    await store.put({ ...input, body: Buffer.from('second') });

    expect(store.written).toHaveLength(2);
    expect(await store.read('renders/u/j/clip-0.png')).toEqual(Buffer.from('second'));
  });
});
