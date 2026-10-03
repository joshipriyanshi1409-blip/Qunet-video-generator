import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EnvValidationError, parseApiEnv } from '../config/env.js';
import { createConfig, requireModelId } from '../config/index.js';
import { normalizePrivateKey } from '../lib/firebase-admin.js';

describe('parseApiEnv', () => {
  it('applies defaults', () => {
    const env = parseApiEnv({});
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(4000);
    expect(env.API_PREFIX).toBe('/api/v1');
    expect(env.REDIS_URL).toBe('redis://127.0.0.1:6379');
    expect(env.REDIS_ENABLED).toBe(true);
    expect(env.QUEUE_PREFIX).toBe('creatordna');
    expect(env.RATE_LIMIT_MAX).toBe(120);
    expect(env.DEV_AUTH_BYPASS).toBe(false);
  });

  it('coerces numeric env vars', () => {
    const env = parseApiEnv({ PORT: '4100', RATE_LIMIT_MAX: '10' });
    expect(env.PORT).toBe(4100);
    expect(env.RATE_LIMIT_MAX).toBe(10);
  });

  it('does not treat the string "false" as true', () => {
    expect(parseApiEnv({ LOG_PRETTY: 'false' }).LOG_PRETTY).toBe(false);
    expect(parseApiEnv({ LOG_PRETTY: 'true' }).LOG_PRETTY).toBe(true);
    expect(parseApiEnv({ LOG_PRETTY: '0' }).LOG_PRETTY).toBe(false);
    expect(parseApiEnv({ LOG_PRETTY: 'yes' }).LOG_PRETTY).toBe(true);
    expect(parseApiEnv({ DEV_AUTH_BYPASS: 'off' }).DEV_AUTH_BYPASS).toBe(false);
  });

  it('rejects a non-numeric port', () => {
    expect(() => parseApiEnv({ PORT: 'not-a-number' })).toThrow(EnvValidationError);
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() => parseApiEnv({ NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });

  it('refuses to start in production with the dev auth bypass on', () => {
    expect(() =>
      parseApiEnv({ NODE_ENV: 'production', DEV_AUTH_BYPASS: 'true' }),
    ).toThrow(/DEV_AUTH_BYPASS/);
  });

  it('requires Firebase configuration in production', () => {
    expect(() => parseApiEnv({ NODE_ENV: 'production' })).toThrow(/FIREBASE_PROJECT_ID/);
    expect(() =>
      parseApiEnv({ NODE_ENV: 'production', FIREBASE_PROJECT_ID: 'demo' }),
    ).toThrow(/FIREBASE_PRIVATE_KEY/);
  });

  it('accepts a complete production configuration', () => {
    const env = parseApiEnv({
      NODE_ENV: 'production',
      FIREBASE_PROJECT_ID: 'demo',
      FIREBASE_CLIENT_EMAIL: 'sa@demo.iam.gserviceaccount.com',
      FIREBASE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n',
      GOOGLE_APPLICATION_CREDENTIALS: '/nonexistent/path.json',
    });
    expect(env.FIREBASE_PROJECT_ID).toBe('demo');
  });

  it('rejects a private key that is not a PEM key', () => {
    expect(() => parseApiEnv({ FIREBASE_PRIVATE_KEY: 'hunter2' })).toThrow(
      /FIREBASE_PRIVATE_KEY/,
    );
  });

  it('lifts the project id out of GOOGLE_APPLICATION_CREDENTIALS', () => {
    const dir = mkdtempSync(join(tmpdir(), 'creatordna-env-'));
    const file = join(dir, 'service-account.json');
    writeFileSync(
      file,
      JSON.stringify({
        project_id: 'from-adc-file',
        client_email: 'sa@from-adc-file.iam.gserviceaccount.com',
        private_key: '-----BEGIN PRIVATE KEY-----\\nxyz\\n-----END PRIVATE KEY-----\\n',
      }),
      'utf8',
    );

    const env = parseApiEnv({ GOOGLE_APPLICATION_CREDENTIALS: file });
    expect(env.FIREBASE_PROJECT_ID).toBe('from-adc-file');
    expect(env.FIREBASE_CLIENT_EMAIL).toBe('sa@from-adc-file.iam.gserviceaccount.com');
    expect(env.FIREBASE_PRIVATE_KEY).toContain('BEGIN PRIVATE KEY');
  });

  it('ignores an unreadable GOOGLE_APPLICATION_CREDENTIALS file', () => {
    const env = parseApiEnv({ GOOGLE_APPLICATION_CREDENTIALS: '/does/not/exist.json' });
    expect(env.FIREBASE_PROJECT_ID).toBeUndefined();
  });
});

describe('createConfig', () => {
  it('splits CORS origins', () => {
    const config = createConfig(parseApiEnv({ CORS_ORIGINS: 'http://a.test, http://b.test' }));
    expect(config.corsOrigins).toEqual(['http://a.test', 'http://b.test']);
  });

  it('exposes model ids from env only', () => {
    const config = createConfig(parseApiEnv({ GEMINI_TEXT_MODEL: 'gemini-test-1' }));
    expect(config.models.geminiText).toBe('gemini-test-1');
    expect(config.models.veo).toBeUndefined();
  });

  it('derives environment flags', () => {
    expect(createConfig(parseApiEnv({ NODE_ENV: 'test' })).isTest).toBe(true);
    expect(createConfig(parseApiEnv({})).isDevelopment).toBe(true);

    const production = createConfig(
      parseApiEnv({
        NODE_ENV: 'production',
        FIREBASE_PROJECT_ID: 'demo',
        FIREBASE_CLIENT_EMAIL: 'sa@demo.iam.gserviceaccount.com',
        FIREBASE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
      }),
    );
    expect(production.isProduction).toBe(true);
    expect(production.isDevelopment).toBe(false);
  });
});

describe('requireModelId', () => {
  it('fails loudly when a model is not configured', () => {
    const config = createConfig(parseApiEnv({}));
    expect(() => requireModelId(config, 'geminiText')).toThrow(/No model configured/);
  });

  it('returns the configured id', () => {
    const config = createConfig(parseApiEnv({ TRANSCRIBE_MODEL: 'transcribe-test-1' }));
    expect(requireModelId(config, 'transcribe')).toBe('transcribe-test-1');
  });
});

describe('normalizePrivateKey', () => {
  it('converts escaped newlines and strips wrapping quotes', () => {
    expect(normalizePrivateKey('"-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n"')).toBe(
      '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
    );
  });

  it('leaves an already-normalized key untouched', () => {
    const key = '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----';
    expect(normalizePrivateKey(key)).toBe(key);
  });
});
