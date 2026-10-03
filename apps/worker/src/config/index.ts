import { MODEL_KEYS, type ModelKey } from '@creatordna/shared';
import type { RedisOptions } from 'ioredis';
import type { WorkerEnv } from './env.js';

export const SERVICE_NAME = 'creatordna-worker';
export const SERVICE_VERSION = '0.1.0';

export interface WorkerConfig {
  readonly env: WorkerEnv;
  readonly serviceName: string;
  readonly version: string;
  readonly isProduction: boolean;
  readonly isTest: boolean;
  readonly isDevelopment: boolean;
  readonly redis: RedisOptions;
  readonly models: Readonly<Record<ModelKey, string | undefined>>;
}

export class ConfigError extends Error {
  readonly code = 'config_error';
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function createConfig(env: WorkerEnv): WorkerConfig {
  const target = new URL(env.REDIS_URL);
  const redis: RedisOptions = {
    host: target.hostname || '127.0.0.1',
    port: target.port === '' ? 6379 : Number.parseInt(target.port, 10),
  };
  if (target.username !== '') redis.username = decodeURIComponent(target.username);
  if (target.password !== '') redis.password = decodeURIComponent(target.password);
  const db = target.pathname.replace('/', '');
  if (db !== '') {
    const parsed = Number.parseInt(db, 10);
    if (Number.isFinite(parsed)) redis.db = parsed;
  }
  // BullMQ workers must be allowed to block on Redis.
  redis.maxRetriesPerRequest = null;
  redis.enableReadyCheck = true;
  redis.connectionName = 'creatordna-worker';

  return {
    env,
    serviceName: SERVICE_NAME,
    version: SERVICE_VERSION,
    isProduction: env.NODE_ENV === 'production',
    isTest: env.NODE_ENV === 'test',
    isDevelopment: env.NODE_ENV === 'development',
    redis,
    models: {
      geminiText: env.GEMINI_TEXT_MODEL,
      geminiLive: env.GEMINI_LIVE_MODEL,
      veo: env.VEO_MODEL,
      lyria: env.LYRIA_MODEL,
      tts: env.TTS_MODEL,
      transcribe: env.TRANSCRIBE_MODEL,
      fallback: env.AI_FALLBACK_MODEL,
    },
  };
}

/**
 * Reads a model id for a slot, throwing a descriptive error when it is missing.
 * This is the only place a model id may be read from configuration.
 */
export function requireModelId(config: WorkerConfig, key: ModelKey): string {
  const model = config.models[key];
  if (model === undefined || model.trim().length === 0) {
    throw new ConfigError(
      `No model configured for "${key}". Set the matching environment variable (see .env.example).`,
    );
  }
  return model;
}

export { MODEL_KEYS };
export type { ModelKey };
