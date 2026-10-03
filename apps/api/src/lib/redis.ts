import { Redis, type RedisOptions } from 'ioredis';
import type { Logger } from 'pino';
import type { AppConfig } from '../config/index.js';

export interface RedisTarget {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db?: number;
}

/** Parses `redis://user:pass@host:6379/1` into ioredis options. */
export function parseRedisUrl(url: string): RedisTarget {
  const parsed = new URL(url);
  const target: RedisTarget = {
    host: parsed.hostname || '127.0.0.1',
    port: parsed.port === '' ? 6379 : Number.parseInt(parsed.port, 10),
  };
  if (parsed.username !== '') target.username = decodeURIComponent(parsed.username);
  if (parsed.password !== '') target.password = decodeURIComponent(parsed.password);
  const db = parsed.pathname.replace('/', '');
  if (db !== '') {
    const parsedDb = Number.parseInt(db, 10);
    if (Number.isFinite(parsedDb)) target.db = parsedDb;
  }
  return target;
}

export function redisOptions(config: AppConfig): RedisOptions {
  const target = parseRedisUrl(config.env.REDIS_URL);
  return {
    ...target,
    // BullMQ requires blocking commands to be able to wait for a connection.
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    connectionName: 'creatordna-api',
  };
}

/**
 * Creates the API's Redis client, or `null` when Redis is disabled.
 *
 * The API only produces jobs and answers `/health`; the worker owns the heavy
 * connections (engineering rule 5).
 */
export function createRedisClient(config: AppConfig, logger: Logger): Redis | null {
  if (!config.env.REDIS_ENABLED) {
    logger.info('redis disabled by configuration');
    return null;
  }

  const client = new Redis(redisOptions(config));

  client.on('error', (error: Error) => {
    logger.error({ err: error }, 'redis connection error');
  });
  client.on('connect', () => {
    logger.debug({ redis: config.env.REDIS_URL }, 'redis connected');
  });

  return client;
}

/** Pings Redis, resolving `false` instead of hanging when it is down. */
export async function pingRedis(client: Redis | null, timeoutMs = 1500): Promise<boolean> {
  if (client === null) return false;
  if (client.status !== 'ready' && client.status !== 'connecting' && client.status !== 'connect') {
    return false;
  }

  let timer: NodeJS.Timeout | undefined;
  try {
    const result = await Promise.race([
      client.ping(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
    return result === 'PONG';
  } catch {
    return false;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function closeRedisClient(client: Redis | null): Promise<void> {
  if (client === null) return;
  try {
    await client.quit();
  } catch {
    client.disconnect();
  }
}
