import { describe, expect, it, vi } from 'vitest';
import { QUEUE_NAMES } from '@creatordna/shared';
import { createLogger } from '@creatordna/shared/logger';

/**
 * Captures what `createPingWorker` hands to BullMQ. A worker that polls the
 * default `bull:` prefix while the API produces to `creatordna:` silently
 * consumes nothing, which is exactly the regression this guards against.
 */
const { workerCalls } = vi.hoisted(() => {
  return { workerCalls: [] as Array<{ queueName: string; options: Record<string, unknown> }> };
});

vi.mock('bullmq', () => {
  class FakeWorker {
    constructor(queueName: string, _processor: unknown, options: Record<string, unknown>) {
      workerCalls.push({ queueName, options });
    }
    on(): this {
      return this;
    }
    async close(): Promise<void> {}
  }
  return { Worker: FakeWorker };
});

const { createPingWorker } = await import('../workers/ping.worker.js');

const logger = createLogger({ level: 'silent' });

describe('createPingWorker', () => {
  it('listens on the ping queue with the producer prefix', () => {
    createPingWorker({
      connection: { host: '127.0.0.1', port: 6379 },
      logger,
      concurrency: 4,
      prefix: 'creatordna',
    });

    const call = workerCalls.at(-1);
    expect(call?.queueName).toBe(QUEUE_NAMES.ping);
    expect(call?.options.prefix).toBe('creatordna');
    expect(call?.options.concurrency).toBe(4);
  });

  it('uses the configured prefix, never the bullmq default', () => {
    createPingWorker({
      connection: { host: '127.0.0.1', port: 6379 },
      logger,
      concurrency: 1,
      prefix: 'staging',
    });

    expect(workerCalls.at(-1)?.options.prefix).toBe('staging');
    expect(workerCalls.at(-1)?.options.prefix).not.toBe('bull');
  });

  it('allows blocking commands on the shared connection', () => {
    createPingWorker({
      connection: { host: '127.0.0.1', port: 6379, maxRetriesPerRequest: null },
      logger,
      concurrency: 2,
      prefix: 'creatordna',
    });

    expect(workerCalls.at(-1)?.options.connection).toMatchObject({
      maxRetriesPerRequest: null,
    });
  });
});
