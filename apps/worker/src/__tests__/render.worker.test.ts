import { describe, expect, it, vi } from 'vitest';
import { QUEUE_NAMES } from '@creatordna/shared';
import { createLogger } from '@creatordna/shared/logger';
import {
  createMockComposer,
  createMockRenderAi,
  createMemoryAssetStore,
  createMemoryRenderJobRepository,
} from '@creatordna/render';

/**
 * Captures what `createRenderWorker` hands to BullMQ.
 *
 * The prefix assertion is the one that matters: a worker polling the default
 * `bull:` prefix while the API produces to `creatordna:` consumes nothing at all,
 * and the symptom is a render that sits at 0% forever.
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

const { createRenderWorker } = await import('../workers/render.worker.js');

const logger = createLogger({ level: 'silent' });

function renderDeps() {
  return {
    repository: createMemoryRenderJobRepository(),
    store: createMemoryAssetStore(),
    ai: createMockRenderAi(),
    composer: createMockComposer(),
    events: null,
    workRoot: '/tmp/creatordna-work',
    width: 1080,
    height: 1920,
    logger,
  };
}

describe('createRenderWorker', () => {
  it('listens on the render queue with the producer prefix', () => {
    createRenderWorker({
      connection: { host: '127.0.0.1', port: 6379 },
      logger,
      concurrency: 4,
      prefix: 'creatordna',
      render: renderDeps(),
    });

    const call = workerCalls.at(-1);
    expect(call?.queueName).toBe(QUEUE_NAMES.render);
    expect(call?.options.prefix).toBe('creatordna');
    expect(call?.options.prefix).not.toBe('bull');
  });

  it('caps its own concurrency well below the configured worker concurrency', () => {
    // A render is minutes of CPU and hundreds of megabytes of scratch space.
    // Running four at once because the ping worker can is how a laptop dies.
    createRenderWorker({
      connection: { host: '127.0.0.1', port: 6379 },
      logger,
      concurrency: 8,
      prefix: 'creatordna',
      render: renderDeps(),
    });

    expect(workerCalls.at(-1)?.options.concurrency).toBe(2);
  });

  it('never drops below one, however the config is set', () => {
    createRenderWorker({
      connection: { host: '127.0.0.1', port: 6379 },
      logger,
      concurrency: 0,
      prefix: 'creatordna',
      render: renderDeps(),
    });

    expect(workerCalls.at(-1)?.options.concurrency).toBe(1);
  });

  it('holds a long lock, because a render outlives BullMQ\u2019s default one', () => {
    createRenderWorker({
      connection: { host: '127.0.0.1', port: 6379 },
      logger,
      concurrency: 2,
      prefix: 'creatordna',
      render: renderDeps(),
    });

    // Five minutes: a 45-second short with eight scenes of asset generation is
    // not going to finish inside BullMQ's 30-second default.
    expect(workerCalls.at(-1)?.options.lockDuration).toBe(300_000);
  });
});
