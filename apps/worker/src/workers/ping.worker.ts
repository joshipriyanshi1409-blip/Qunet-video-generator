import { Worker, type WorkerOptions } from 'bullmq';
import { QUEUE_NAMES, type PingJobData, type PingJobResult } from '@creatordna/shared';
import type { Logger } from 'pino';
import type { RedisOptions } from 'ioredis';
import { createPingProcessor } from '../jobs/ping.job.js';

export type PingWorker = Worker<PingJobData, PingJobResult, string>;

export interface CreatePingWorkerDeps {
  connection: RedisOptions;
  logger: Logger;
  concurrency: number;
  /** Must match the producer's `QUEUE_PREFIX`, or the worker polls the wrong keys. */
  prefix: string;
}

/**
 * The ping worker: a demo that proves the queue -> worker -> Redis round trip.
 *
 * It also demonstrates the two behaviours the render pipeline needs - progress
 * reporting, and retries that only re-run the failed attempt. The real render
 * worker is `render.worker.ts` in this directory.
 */
export function createPingWorker(deps: CreatePingWorkerDeps): PingWorker {
  const options: WorkerOptions = {
    connection: deps.connection,
    concurrency: deps.concurrency,
    lockDuration: 30_000,
    prefix: deps.prefix,
  };

  const worker = new Worker<PingJobData, PingJobResult, string>(
    QUEUE_NAMES.ping,
    createPingProcessor({
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      now: () => new Date(),
      logger: deps.logger,
    }),
    options,
  );

  worker.on('ready', () => {
    deps.logger.info(
      { queue: QUEUE_NAMES.ping, prefix: deps.prefix, concurrency: deps.concurrency },
      'worker ready',
    );
  });

  worker.on('completed', (job, result) => {
    deps.logger.info({ jobId: String(job.id), result }, 'ping job completed');
  });

  worker.on('failed', (job, error) => {
    deps.logger.warn(
      {
        jobId: job === undefined ? null : String(job.id),
        attemptsMade: job?.attemptsMade,
        err: error,
      },
      'ping job failed',
    );
  });

  worker.on('error', (error: Error) => {
    deps.logger.error({ err: error }, 'worker error');
  });

  return worker;
}
