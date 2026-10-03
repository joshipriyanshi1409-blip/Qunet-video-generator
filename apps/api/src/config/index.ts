import { MODEL_KEYS, type ModelKey } from '@creatordna/shared';
import type { ApiEnv } from './env.js';

export { MODEL_KEYS };
export type { ModelKey };

export const SERVICE_NAME = 'creatordna-api';
export const SERVICE_VERSION = '0.1.0';

export interface AppConfig {
  readonly env: ApiEnv;
  readonly serviceName: string;
  readonly version: string;
  readonly isProduction: boolean;
  readonly isTest: boolean;
  readonly isDevelopment: boolean;
  readonly corsOrigins: string[];
  /** Undefined means "not configured" - callers must fail loudly. */
  readonly models: Readonly<Record<ModelKey, string | undefined>>;
}

export class ConfigError extends Error {
  readonly code = 'config_error';
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function createConfig(env: ApiEnv): AppConfig {
  return {
    env,
    serviceName: SERVICE_NAME,
    version: SERVICE_VERSION,
    isProduction: env.NODE_ENV === 'production',
    isTest: env.NODE_ENV === 'test',
    isDevelopment: env.NODE_ENV === 'development',
    corsOrigins: env.CORS_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
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
export function requireModelId(config: AppConfig, key: ModelKey): string {
  const model = config.models[key];
  if (model === undefined || model.trim().length === 0) {
    throw new ConfigError(
      `No model configured for "${key}". Set the matching environment variable (see .env.example).`,
    );
  }
  return model;
}
