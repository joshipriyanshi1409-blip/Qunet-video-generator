import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockRenderAi } from '../ai.js';
import { createDemoAssetCache, demoKey, withDemoCache } from '../demoCache.js';
import type { RenderCreateRequest, Storyboard } from '@creatordna/shared';

/**
 * The demo cache.
 *
 * The property that matters is that it never calls the model once warm - a demo
 * that spends a quota is not a demo. So every test counts inner calls rather
 * than asserting on the bytes.
 */

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'demo-cache-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

/** A counting AI: the inner one whose calls must go to zero after a warm-up. */
function countingAi() {
  const inner = createMockRenderAi();
  const calls = {
    storyboard: 0,
    clip: 0,
    voice: 0,
    music: 0,
    captions: 0,
  };
  return {
    calls,
    ai: {
      mode: 'mock' as const,
      buildStoryboard: async (payload: RenderCreateRequest, dna: Storyboard extends never ? never : null) => {
        calls.storyboard += 1;
        return inner.buildStoryboard(payload, dna);
      },
      generateClip: async (request: Parameters<typeof inner.generateClip>[0]) => {
        calls.clip += 1;
        return inner.generateClip(request);
      },
      synthesizeVoice: async (request: Parameters<typeof inner.synthesizeVoice>[0]) => {
        calls.voice += 1;
        return inner.synthesizeVoice(request);
      },
      composeMusic: async (request: Parameters<typeof inner.composeMusic>[0]) => {
        calls.music += 1;
        return inner.composeMusic(request);
      },
      alignCaptions: async (request: Parameters<typeof inner.alignCaptions>[0]) => {
        calls.captions += 1;
        return inner.alignCaptions(request);
      },
    },
  };
}

const payload = {
  idea: 'Explain binary search',
  // `mockStoryboard` puts the hook on the first scene's on-screen text.
  hook: 'Binary search in 30 seconds.',
  script: [
    { scene: 'Hook', text: 'Binary search in 30 seconds.' },
    { scene: 'Turn', text: 'The search space halves.' },
  ],
  cta: 'Follow for more.',
} as unknown as RenderCreateRequest;

const clipRequest = {
  sceneIndex: 0,
  visualPrompt: 'a whiteboard with a halving array',
  narration: 'Binary search in 30 seconds.',
  durationSeconds: 4,
  width: 1080,
  height: 1920,
} as Parameters<ReturnType<typeof createMockRenderAi>['generateClip']>[0];

const voiceRequest = {
  lines: [{ narration: 'Binary search in 30 seconds.', durationSeconds: 4 }],
} as Parameters<ReturnType<typeof createMockRenderAi>['synthesizeVoice']>[0];

const musicRequest = {
  durationSeconds: 8,
} as Parameters<ReturnType<typeof createMockRenderAi>['composeMusic']>[0];

const captionRequest = {
  voice: Buffer.alloc(16),
  lines: [{ narration: 'Binary search in 30 seconds.', durationSeconds: 4 }],
  durationSeconds: 8,
} as unknown as Parameters<ReturnType<typeof createMockRenderAi>['alignCaptions']>[0];

describe('demo asset cache', () => {
  it('returns null for a cold slot', async () => {
    const cache = createDemoAssetCache({ dir: directory });
    expect(await cache.read('voice')).toBeNull();
  });

  it('round-trips bytes and metadata', async () => {
    const cache = createDemoAssetCache({ dir: directory });
    const media = {
      bytes: Buffer.from('hello'),
      mimeType: 'audio/wav',
      extension: 'wav',
      durationSeconds: 3,
    };

    await cache.write('voice', media);
    const back = await cache.read('voice');

    expect(back?.bytes.toString()).toBe('hello');
    expect(back?.mimeType).toBe('audio/wav');
    expect(back?.durationSeconds).toBe(3);
    expect(await cache.has('voice')).toBe(true);
  });

  it('stores bytes and metadata as separate files, so a torn write is visible', async () => {
    const cache = createDemoAssetCache({ dir: directory });
    await cache.write('voice', { bytes: Buffer.from('abc'), mimeType: 'audio/wav', extension: 'wav' });

    expect(await stat(join(directory, 'voice.wav')).then(() => true).catch(() => false)).toBe(true);
    expect(await stat(join(directory, 'voice.meta.json')).then(() => true).catch(() => false)).toBe(true);
    // And the metadata is not sitting where the bytes are.
    expect(await stat(join(directory, 'voice.json')).then(() => true).catch(() => false)).toBe(false);
  });

  it('treats metadata with no bytes as cold rather than failing the render', async () => {
    const cache = createDemoAssetCache({ dir: directory });
    await cache.write('voice', { bytes: Buffer.from('abc'), mimeType: 'audio/wav', extension: 'wav' });
    // Simulate a crash between the two writes.
    await rm(join(directory, 'voice.wav'));

    expect(await cache.read('voice')).toBeNull();
  });

  it('sanitises a hostile key into a filename', async () => {
    const cache = createDemoAssetCache({ dir: directory });
    await cache.write('../../etc/passwd', {
      bytes: Buffer.from('x'),
      mimeType: 'text/plain',
      extension: 'txt',
    });

    // The write landed inside the cache directory, nowhere else.
    const escaped = await stat(join(directory, '..', '..', 'etc', 'passwd.txt'))
      .then(() => true)
      .catch(() => false);
    expect(escaped).toBe(false);
    expect(await cache.has('../../etc/passwd')).toBe(true);
  });

  it('round-trips a storyboard as JSON', async () => {
    const cache = createDemoAssetCache({ dir: directory });
    const inner = createMockRenderAi();
    const storyboard = await inner.buildStoryboard(payload, null);

    await cache.writeStoryboard('storyboard', storyboard);
    const back = await cache.readStoryboard('storyboard');

    expect(back).toEqual(storyboard);
  });
});

describe('withDemoCache', () => {
  it('serves a second render from the cache without touching the inner AI', async () => {
    const cache = createDemoAssetCache({ dir: directory });
    const counting = countingAi();
    const demo = withDemoCache(counting.ai, cache);

    await demo.buildStoryboard(payload, null);
    await demo.generateClip(clipRequest);
    await demo.synthesizeVoice(voiceRequest);
    await demo.composeMusic(musicRequest);
    await demo.alignCaptions(captionRequest);

    expect(counting.calls).toEqual({ storyboard: 1, clip: 1, voice: 1, music: 1, captions: 1 });

    // A second, identical run.
    await demo.buildStoryboard(payload, null);
    await demo.generateClip(clipRequest);
    await demo.synthesizeVoice(voiceRequest);
    await demo.composeMusic(musicRequest);
    await demo.alignCaptions(captionRequest);

    expect(counting.calls).toEqual({ storyboard: 1, clip: 1, voice: 1, music: 1, captions: 1 });
  });

  it('reports itself as demo mode, so a log line says where the bytes came from', async () => {
    const cache = createDemoAssetCache({ dir: directory });
    const demo = withDemoCache(createMockRenderAi(), cache);
    expect(demo.mode).toBe('demo');
  });

  it('marks a cache hit in the note, so a stale asset is never silent', async () => {
    const cache = createDemoAssetCache({ dir: directory });
    await cache.write('clip:0', {
      bytes: Buffer.from('still'),
      mimeType: 'image/png',
      extension: 'png',
      note: 'a still frame',
    });

    const demo = withDemoCache(createMockRenderAi(), cache);
    const media = await demo.generateClip(clipRequest);

    expect(media.note).toContain('demo cache');
    expect(media.bytes.toString()).toBe('still');
  });

  it('keeps one clip slot per scene, so a cache hit for scene 0 is not scene 1', async () => {
    const cache = createDemoAssetCache({ dir: directory });
    const counting = countingAi();
    const demo = withDemoCache(counting.ai, cache);

    await demo.generateClip(clipRequest);
    await demo.generateClip({ ...clipRequest, sceneIndex: 1 });
    await demo.generateClip(clipRequest);

    expect(counting.calls.clip).toBe(2);
  });

  it('returns the identical bytes on a hit, so the composer sees a stable input', async () => {
    const cache = createDemoAssetCache({ dir: directory });
    const demo = withDemoCache(createMockRenderAi(), cache);

    const first = await demo.synthesizeVoice(voiceRequest);
    const second = await demo.synthesizeVoice(voiceRequest);

    expect(second.bytes.equals(first.bytes)).toBe(true);
    expect(second.mimeType).toBe(first.mimeType);
  });

  it('regenerates a corrupt caption entry instead of serving it', async () => {
    const cache = createDemoAssetCache({ dir: directory });
    await cache.write('captions', {
      bytes: Buffer.from('not json'),
      mimeType: 'application/json',
      extension: 'json',
    });

    const counting = countingAi();
    const demo = withDemoCache(counting.ai, cache);
    const segments = await demo.alignCaptions(captionRequest);

    expect(counting.calls.captions).toBe(1);
    expect(segments.length).toBeGreaterThan(0);
    // And it healed the entry, so the next run is a hit.
    await demo.alignCaptions(captionRequest);
    expect(counting.calls.captions).toBe(1);
  });

  it('survives a cache directory that does not exist yet', async () => {
    const nested = join(directory, 'deeply', 'nested');
    const cache = createDemoAssetCache({ dir: nested });
    const demo = withDemoCache(createMockRenderAi(), cache);

    const media = await demo.synthesizeVoice(voiceRequest);
    expect(media.bytes.length).toBeGreaterThan(0);
    expect(await cache.read('voice')).not.toBeNull();
  });

  it('logs a store line when a logger is supplied', async () => {
    const lines: string[] = [];
    const logger = {
      // pino's signature is (payload, message), so the message is the second arg.
      debug: (_payload: unknown, message?: string) => lines.push(String(message)),
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      fatal: () => undefined,
      trace: () => undefined,
      child: () => logger,
      level: 'debug',
      silent: () => undefined,
    } as unknown as Parameters<typeof createDemoAssetCache>[0]['logger'];

    const cache = createDemoAssetCache({ dir: directory, logger });
    await cache.write('voice', { bytes: Buffer.from('x'), mimeType: 'audio/wav', extension: 'wav' });

    expect(lines.some((line) => line.includes('demo cache: stored'))).toBe(true);
  });
});

describe('demoKey', () => {
  it('is stable for the same parts and different for different parts', () => {
    expect(demoKey(['a', 'b'])).toBe(demoKey(['a', 'b']));
    expect(demoKey(['a', 'b'])).not.toBe(demoKey(['a', 'c']));
  });

  it('does not leak a separator into the digest', () => {
    // `['a', 'b']` and `['a\u0000b']` must not collide.
    expect(demoKey(['a', 'b'])).not.toBe(demoKey(['a\u0000b']));
  });

  it('produces a filename-safe string', async () => {
    const cache = createDemoAssetCache({ dir: directory });
    await cache.write(demoKey(['a', 'b']), {
      bytes: Buffer.from('x'),
      mimeType: 'text/plain',
      extension: 'txt',
    });
    const names = await readFile(join(directory, `${demoKey(['a', 'b'])}.meta.json`), 'utf8');
    expect(names).toContain('text/plain');
  });
});

describe('the cache is not enabled implicitly', () => {
  it('leaves a plain mock AI alone', async () => {
    const cache = createDemoAssetCache({ dir: directory });
    const ai = createMockRenderAi();

    // Nothing written by the unwrapped AI.
    await ai.generateClip(clipRequest);

    // The directory exists (mkdtemp made it); what matters is that the
    // unwrapped AI wrote nothing into it.
    const entries = await readdir(directory);
    expect(entries).toEqual([]);
    expect(await cache.has('clip:0')).toBe(false);
  });
});
