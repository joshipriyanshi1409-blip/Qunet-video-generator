import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Logger } from 'pino';
import type { Storyboard } from '@creatordna/shared';
import type { CaptionSegment, RenderMedia } from './mediaModels.js';
import type { RenderAi } from './ai.js';

/**
 * The demo cache.
 *
 * A stage's output is expensive and, for a demo, irrelevant: what the audience
 * needs is a video that plays, in a reasonable time, with no API key and no
 * quota. So each stage's result is memoised on disk and replayed.
 *
 * It is a **read-through** cache, not a switch: the first render populates it and
 * every later render reads it. `DEMO_MODE=true` is what makes that the only path
 * taken, because it also selects the mock AI underneath - so a demo run touches
 * no model at all once the cache is warm.
 *
 * Keys are slot-shaped (`clip:0`, `voice`, `music`, `storyboard`, `captions`)
 * rather than content-shaped on purpose. A content hash would make the cache a
 * per-creator, per-idea snowflake that never hits twice; a slot key gives one
 * bounded, curated set of golden assets that every demo render shares. That is
 * the trade a demo wants, and it is why the cache is never enabled implicitly.
 */

/** Everything the cache stores, in one shape. */
interface CacheEntry {
  mimeType: string;
  extension: string;
  durationSeconds?: number;
  note?: string;
}

export interface DemoAssetCache {
  readonly dir: string;
  /** The stored bytes plus metadata, or null when the slot is cold. */
  read(key: string): Promise<RenderMedia | null>;
  /** Writes the bytes and its metadata sidecar. */
  write(key: string, media: RenderMedia): Promise<void>;
  /** The storyboard is JSON, not media, so it gets its own pair. */
  readStoryboard(key: string): Promise<Storyboard | null>;
  writeStoryboard(key: string, storyboard: Storyboard): Promise<void>;
  /** True when the slot already holds something. */
  has(key: string): Promise<boolean>;
}

export interface DemoAssetCacheOptions {
  dir: string;
  logger?: Logger;
}

/** A safe filename for a slot key. Slot keys are ours, but be defensive anyway. */
function safeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'empty';
}

/**
 * Metadata lives under its own suffix so it can never collide with the bytes.
 *
 * `<key>.meta.json` and `<key>.json` are different files; `<key>.json` and
 * `<key>.json` are the same file, and a storyboard entry would have had its
 * bytes overwritten by its own metadata. A cache that serves its own bookkeeping
 * as if it were the asset is worse than a cold cache.
 */
function metaPath(dir: string, key: string): string {
  return join(dir, `${safeKey(key)}.meta.json`);
}
function bytesPath(dir: string, key: string, extension: string): string {
  return join(dir, `${safeKey(key)}.${extension}`);
}

export function createDemoAssetCache(options: DemoAssetCacheOptions): DemoAssetCache {
  const { dir, logger } = options;

  async function readMeta(key: string): Promise<CacheEntry | null> {
    try {
      const parsed = JSON.parse(await readFile(metaPath(dir, key), 'utf8')) as Partial<CacheEntry>;
      if (typeof parsed.mimeType !== 'string' || typeof parsed.extension !== 'string') return null;
      return {
        mimeType: parsed.mimeType,
        extension: parsed.extension,
        durationSeconds:
          typeof parsed.durationSeconds === 'number' ? parsed.durationSeconds : undefined,
        note: typeof parsed.note === 'string' ? parsed.note : undefined,
      };
    } catch {
      return null;
    }
  }

  async function writeMeta(key: string, entry: CacheEntry): Promise<void> {
    await mkdir(dirname(metaPath(dir, key)), { recursive: true });
    await writeFile(metaPath(dir, key), `${JSON.stringify(entry, null, 2)}\n`, 'utf8');
  }

  return {
    dir,

    async read(key) {
      const meta = await readMeta(key);
      if (meta === null) return null;
      try {
        const bytes = await readFile(bytesPath(dir, key, meta.extension));
        // `meta` already carries mimeType/extension; naming them again would
        // just be overwritten by the spread.
        return { bytes, ...meta };
      } catch {
        // Metadata without bytes is a cold slot, not an error: a torn write
        // should fall through to the generator rather than fail a render.
        logger?.debug({ key }, 'demo cache: metadata without bytes, treating as cold');
        return null;
      }
    },

    async write(key, media) {
      const entry: CacheEntry = {
        mimeType: media.mimeType,
        extension: media.extension,
        ...(media.durationSeconds === undefined ? {} : { durationSeconds: media.durationSeconds }),
        ...(media.note === undefined ? {} : { note: media.note }),
      };
      await mkdir(dirname(bytesPath(dir, key, entry.extension)), { recursive: true });
      await writeFile(bytesPath(dir, key, entry.extension), media.bytes);
      await writeMeta(key, entry);
      logger?.debug({ key, bytes: media.bytes.length }, 'demo cache: stored');
    },

    async readStoryboard(key) {
      const media = await this.read(`${key}.storyboard`);
      if (media === null) return null;
      try {
        return JSON.parse(media.bytes.toString('utf8')) as Storyboard;
      } catch {
        return null;
      }
    },

    async writeStoryboard(key, storyboard) {
      await this.write(`${key}.storyboard`, {
        bytes: Buffer.from(JSON.stringify(storyboard), 'utf8'),
        mimeType: 'application/json',
        extension: 'json',
      });
    },

    async has(key) {
      return (await readMeta(key)) !== null;
    },
  };
}

/**
 * Wraps an AI so every stage reads the cache before it generates anything.
 *
 * The wrapper is transparent about what it did: each generator's `note` is
 * suffixed with `(demo cache)` on a hit, so the job document and the boot log
 * say where the bytes came from. A demo that silently serves stale assets is
 * worse than one that fails.
 */
export function withDemoCache(ai: RenderAi, cache: DemoAssetCache): RenderAi {
  function tag(note: string | undefined, hit: boolean): string | undefined {
    if (!hit) return note;
    return note === undefined ? 'demo cache' : `${note} (demo cache)`;
  }

  async function cached<T extends RenderMedia>(
    key: string,
    generate: () => Promise<T>,
  ): Promise<T> {
    const hit = await cache.read(key);
    if (hit !== null) {
      return { ...hit, note: tag(hit.note, true) } as T;
    }
    const made = await generate();
    await cache.write(key, made);
    return made;
  }

  return {
    mode: 'demo',

    async buildStoryboard(payload, dna) {
      const hit = await cache.readStoryboard('storyboard');
      if (hit !== null) return hit;
      const made = await ai.buildStoryboard(payload, dna);
      await cache.writeStoryboard('storyboard', made);
      return made;
    },

    generateClip(request) {
      return cached(`clip:${request.sceneIndex}`, () => ai.generateClip(request));
    },

    synthesizeVoice(request) {
      return cached('voice', () => ai.synthesizeVoice(request));
    },

    composeMusic(request) {
      return cached('music', () => ai.composeMusic(request));
    },

    async alignCaptions(request) {
      const hit = await cache.read('captions');
      if (hit !== null) {
        try {
          const parsed = JSON.parse(hit.bytes.toString('utf8')) as CaptionSegment[];
          return parsed;
        } catch {
          // Fall through and regenerate rather than serve a corrupt cue list.
        }
      }
      const made = await ai.alignCaptions(request);
      await cache.write('captions', {
        bytes: Buffer.from(JSON.stringify(made), 'utf8'),
        mimeType: 'application/json',
        extension: 'json',
      });
      return made;
    },
  };
}

/** A stable digest, for logging and for cache keys built from a prompt. */
export function demoKey(parts: readonly string[]): string {
  // JSON, not a join: joining on a separator lets `['a','b']` and `['a\u0000b']`
  // produce the same key, which is how one creator's asset gets served to another.
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 16);
}
