import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger, DEFAULT_REDACT_PATHS } from '../logger.js';

function capturingStream() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(String(chunk));
      callback();
    },
  });
  return { stream, lines };
}

describe('createLogger', () => {
  it('honours the requested level', () => {
    const { stream } = capturingStream();
    const logger = createLogger({ level: 'warn', destination: stream });
    expect(logger.level).toBe('warn');
  });

  it('emits structured JSON with the service name attached', async () => {
    const { stream, lines } = capturingStream();
    const logger = createLogger({
      level: 'info',
      name: 'creatordna-test',
      base: { service: 'api' },
      destination: stream,
    });

    logger.info({ jobId: '1' }, 'job started');
    logger.flush();
    await new Promise((resolve) => setImmediate(resolve));

    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
    expect(entry.level).toBe('info');
    expect(entry.service).toBe('api');
    expect(entry.msg).toBe('job started');
    expect(entry.jobId).toBe('1');
    expect(typeof entry.time).toBe('string');
  });

  it('redacts authorization headers and private keys', async () => {
    const { stream, lines } = capturingStream();
    const logger = createLogger({ level: 'debug', destination: stream });

    logger.debug(
      {
        req: { headers: { authorization: 'Bearer super-secret-token' } },
        FIREBASE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----abc',
      },
      'incoming request',
    );
    logger.flush();
    await new Promise((resolve) => setImmediate(resolve));

    const raw = lines.join('\n');
    expect(raw).not.toContain('super-secret-token');
    expect(raw).not.toContain('BEGIN PRIVATE KEY');
    expect(raw).toContain('[Redacted]');
  });

  it('ships a default redact list that covers secrets', () => {
    expect(DEFAULT_REDACT_PATHS).toContain('req.headers.authorization');
    expect(DEFAULT_REDACT_PATHS).toContain('FIREBASE_PRIVATE_KEY');
  });
});
