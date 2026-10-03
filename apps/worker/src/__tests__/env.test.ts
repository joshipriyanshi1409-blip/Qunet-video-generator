import { describe, expect, it } from 'vitest';
import { parseWorkerEnv } from '../config/env.js';
import { createConfig, requireModelId } from '../config/index.js';

describe('parseWorkerEnv', () => {
  it('applies defaults', () => {
    const env = parseWorkerEnv({});
    expect(env.NODE_ENV).toBe('development');
    expect(env.REDIS_URL).toBe('redis://127.0.0.1:6379');
    expect(env.QUEUE_PREFIX).toBe('creatordna');
    expect(env.WORKER_CONCURRENCY).toBe(4);
    expect(env.JOB_MAX_ATTEMPTS).toBe(3);
    expect(env.REDIS_ENABLED).toBe(true);
  });

  it('coerces string numbers and booleans correctly', () => {
    const env = parseWorkerEnv({ WORKER_CONCURRENCY: '8', REDIS_ENABLED: 'false' });
    expect(env.WORKER_CONCURRENCY).toBe(8);
    expect(env.REDIS_ENABLED).toBe(false);
  });

  it('does not treat the string "false" as true', () => {
    expect(parseWorkerEnv({ LOG_PRETTY: 'false' }).LOG_PRETTY).toBe(false);
    expect(parseWorkerEnv({ LOG_PRETTY: 'true' }).LOG_PRETTY).toBe(true);
    expect(parseWorkerEnv({ LOG_PRETTY: 'no' }).LOG_PRETTY).toBe(false);
    expect(parseWorkerEnv({ LOG_PRETTY: '1' }).LOG_PRETTY).toBe(true);
  });

  it('rejects an invalid log level', () => {
    expect(() => parseWorkerEnv({ LOG_LEVEL: 'loud' })).toThrow(/LOG_LEVEL/);
  });

  it('rejects a concurrency outside 1-64', () => {
    expect(() => parseWorkerEnv({ WORKER_CONCURRENCY: '0' })).toThrow(/WORKER_CONCURRENCY/);
    expect(() => parseWorkerEnv({ WORKER_CONCURRENCY: '999' })).toThrow(/WORKER_CONCURRENCY/);
  });

  it('requires Firebase credentials in production', () => {
    expect(() => parseWorkerEnv({ NODE_ENV: 'production' })).toThrow(/FIREBASE_PROJECT_ID/);
    expect(() =>
      parseWorkerEnv({ NODE_ENV: 'production', FIREBASE_PROJECT_ID: 'p' }),
    ).toThrow(/FIREBASE_PRIVATE_KEY/);
  });

  it('rejects a private key that is not a PEM key', () => {
    expect(() => parseWorkerEnv({ FIREBASE_PRIVATE_KEY: 'not-a-key' })).toThrow(
      /FIREBASE_PRIVATE_KEY/,
    );
  });

  it('leaves the media credentials unset by default, so the mocks are used', () => {
    const env = parseWorkerEnv({});
    expect(env.GEMINI_API_KEY).toBeUndefined();
    expect(env.LYRIA_AUTHORIZATION).toBeUndefined();
    expect(env.LYRIA_BASE_URL).toBeUndefined();
    expect(env.TTS_VOICE_NAME).toBeUndefined();
  });

  it('reads the media credentials when they are set', () => {
    const env = parseWorkerEnv({
      GEMINI_API_KEY: 'key-123',
      TTS_VOICE_NAME: 'Kore',
      LYRIA_AUTHORIZATION: 'Bearer ya29.test',
      LYRIA_BASE_URL: 'https://us-central1-aiplatform.googleapis.com/v1',
    });

    expect(env.GEMINI_API_KEY).toBe('key-123');
    expect(env.TTS_VOICE_NAME).toBe('Kore');
    expect(env.LYRIA_AUTHORIZATION).toBe('Bearer ya29.test');
    expect(env.LYRIA_BASE_URL).toBe('https://us-central1-aiplatform.googleapis.com/v1');
  });

  it('treats a blank media credential as unset rather than as an empty string', () => {
    // An empty key would be sent as a header and come back 401, which looks like
    // a Google problem rather than a configuration one.
    const env = parseWorkerEnv({ GEMINI_API_KEY: '   ', TTS_VOICE_NAME: '' });
    expect(env.GEMINI_API_KEY).toBeUndefined();
    expect(env.TTS_VOICE_NAME).toBeUndefined();
  });

  it('rejects a Lyria base URL that is not a URL', () => {
    expect(() => parseWorkerEnv({ LYRIA_BASE_URL: 'us-central1' })).toThrow(/LYRIA_BASE_URL/);
  });

  it('keeps the media poll and timeout inside sane bounds', () => {
    expect(parseWorkerEnv({}).MEDIA_POLL_INTERVAL_MS).toBe(5_000);
    expect(parseWorkerEnv({}).MEDIA_TIMEOUT_MS).toBe(240_000);
    expect(parseWorkerEnv({ MEDIA_POLL_INTERVAL_MS: '2000' }).MEDIA_POLL_INTERVAL_MS).toBe(2_000);
    expect(() => parseWorkerEnv({ MEDIA_POLL_INTERVAL_MS: '10' })).toThrow(/MEDIA_POLL_INTERVAL_MS/);
    expect(() => parseWorkerEnv({ MEDIA_TIMEOUT_MS: '1' })).toThrow(/MEDIA_TIMEOUT_MS/);
  });
});

describe('createConfig', () => {
  it('derives ioredis options from REDIS_URL', () => {
    const config = createConfig(
      parseWorkerEnv({ REDIS_URL: 'redis://user:secret@redis.internal:6380/2' }),
    );
    expect(config.redis.host).toBe('redis.internal');
    expect(config.redis.port).toBe(6380);
    expect(config.redis.username).toBe('user');
    expect(config.redis.password).toBe('secret');
    expect(config.redis.db).toBe(2);
    // BullMQ workers must be allowed to block on Redis.
    expect(config.redis.maxRetriesPerRequest).toBeNull();
  });

  it('defaults the redis port when the URL has none', () => {
    const config = createConfig(parseWorkerEnv({ REDIS_URL: 'redis://localhost' }));
    expect(config.redis.port).toBe(6379);
  });

  it('exposes model ids from env without hard-coding them', () => {
    const config = createConfig(parseWorkerEnv({ VEO_MODEL: 'veo-test-1' }));
    expect(config.models.veo).toBe('veo-test-1');
    expect(config.models.lyria).toBeUndefined();
  });
});

describe('requireModelId', () => {
  it('throws a descriptive error when a model is not configured', () => {
    const config = createConfig(parseWorkerEnv({}));
    expect(() => requireModelId(config, 'veo')).toThrow(/No model configured for "veo"/);
  });

  it('returns the configured id', () => {
    const config = createConfig(parseWorkerEnv({ TTS_MODEL: 'tts-test-1' }));
    expect(requireModelId(config, 'tts')).toBe('tts-test-1');
  });
});
