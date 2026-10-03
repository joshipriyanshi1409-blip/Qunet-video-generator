import type { Logger } from 'pino';
import type { RedisOptions } from 'ioredis';
import { QUEUE_NAMES } from '@creatordna/shared';
import type { PingWorker } from '../workers/ping.worker.js';
import { createPingWorker } from '../workers/ping.worker.js';
import type { RenderWorker } from '../workers/render.worker.js';
import { createRenderWorker } from '../workers/render.worker.js';
import type { RenderJobDeps } from '../lib/renderDeps.js';

export interface WorkerRegistry {
  readonly ping: PingWorker;
  readonly render: RenderWorker;
  close(): Promise<void>;
}

export interface CreateWorkersDeps {
  connection: RedisOptions;
  logger: Logger;
  concurrency: number;
  /** BullMQ key prefix, shared with the API so both sides agree on the keys. */
  prefix: string;
  /** The render pipeline's dependencies. */
  render: RenderJobDeps;
}

/** All BullMQ workers owned by this process. */
export function createWorkers(deps: CreateWorkersDeps): WorkerRegistry {
  const ping = createPingWorker({
    connection: deps.connection,
    logger: deps.logger,
    concurrency: deps.concurrency,
    prefix: deps.prefix,
  });

  const render = createRenderWorker({
    connection: deps.connection,
    logger: deps.logger,
    concurrency: deps.concurrency,
    prefix: deps.prefix,
    render: deps.render,
  });

  return {
    ping,
    render,
    async close() {
      // Render first: a render in flight has scratch files and a lock, and
      // closing the ping worker first would just look tidier in the logs.
      await render.close();
      await ping.close();
    },
  };
}

export { QUEUE_NAMES };
