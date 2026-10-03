import type { Redis } from 'ioredis';
import type { Logger } from 'pino';

/**
 * A tiny TTL cache with a Redis backend and an in-memory fallback.
 *
 * Why both: Redis is shared between API instances, but the API must still answer
 * (correctly, just uncached) when Redis is disabled or down. A cache that turns
 * into an error when it misses is not a cache.
 *
 * Values are JSON strings. A corrupt entry is treated as a miss rather than
 * crashing a request.
 */
export interface Cache {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlMs: number): Promise<void>;
  /** Drops one key (used when a creator's DNA changes). */
  invalidate(key: string): Promise<void>;
  /** Where the last answer came from - logged and surfaced for debugging. */
  readonly backend: 'redis' | 'memory' | 'none';
}

interface MemoryEntry {
  value: string;
  expiresAt: number;
}

export interface CacheOptions {
  redis?: Redis | null;
  logger?: Logger;
  /** Namespace prefix, so a shared Redis does not collide with other apps. */
  prefix?: string;
  /** Injected clock, so tests do not have to wait. */
  now?: () => number;
}

export function createCache(options: CacheOptions = {}): Cache {
  const prefix = options.prefix ?? 'creatordna';
  const now = options.now ?? (() => Date.now());
  const memory = new Map<string, MemoryEntry>();
  const redis = options.redis ?? null;

  function fullKey(key: string): string {
    return `${prefix}:${key}`;
  }

  function sweep(): void {
    const timestamp = now();
    for (const [key, entry] of memory) {
      if (entry.expiresAt <= timestamp) memory.delete(key);
    }
  }

  return {
    backend: redis === null ? 'memory' : 'redis',

    async get<T>(key: string): Promise<T | undefined> {
      if (redis !== null) {
        try {
          const raw = await redis.get(fullKey(key));
          if (raw === null) return undefined;
          return JSON.parse(raw) as T;
        } catch (error) {
          options.logger?.warn({ err: error, key }, 'cache read failed - treating as a miss');
          return undefined;
        }
      }

      sweep();
      const entry = memory.get(key);
      if (entry === undefined || entry.expiresAt <= now()) {
        memory.delete(key);
        return undefined;
      }
      try {
        return JSON.parse(entry.value) as T;
      } catch {
        memory.delete(key);
        return undefined;
      }
    },

    async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
      const payload = JSON.stringify(value);
      const ttlSeconds = Math.max(1, Math.ceil(ttlMs / 1000));

      if (redis !== null) {
        try {
          await redis.set(fullKey(key), payload, 'EX', ttlSeconds);
        } catch (error) {
          options.logger?.warn({ err: error, key }, 'cache write failed - continuing uncached');
        }
        return;
      }

      memory.set(key, { value: payload, expiresAt: now() + ttlMs });
    },

    async invalidate(key: string): Promise<void> {
      if (redis !== null) {
        try {
          await redis.del(fullKey(key));
        } catch (error) {
          options.logger?.warn({ err: error, key }, 'cache invalidate failed');
        }
        return;
      }
      memory.delete(key);
    },
  };
}

/** Cache key for one creator's trend ranking. */
export function trendRankingCacheKey(uid: string): string {
  return `trends:for-me:${uid}`;
}

/** Cache key for one creator's remix of one trend (or one free-text idea). */
export function remixCacheKey(uid: string, target: string): string {
  return `remix:${uid}:${target}`;
}
