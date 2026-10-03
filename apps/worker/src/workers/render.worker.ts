import { Worker, type WorkerOptions } from 'bullmq';
import {
  JOB_NAMES,
  QUEUE_NAMES,
  type RenderJobData,
  type RenderJobResult,
} from '@creatordna/shared';
import type { Logger } from 'pino';
import type { RedisOptions } from 'ioredis';
import type { RenderJobDeps } from '../lib/renderDeps.js';
import { createRenderProcessor } from '../jobs/render.job.js';

export type RenderWorker = Worker<RenderJobData, RenderJobResult, string>;

export interface CreateRenderWorkerDeps {
  connection: RedisOptions;
  logger: Logger;
  concurrency: number;
  /** Must match the producer's `QUEUE_PREFIX`, or the worker polls the wrong keys. */
  prefix: string;
  render: RenderJobDeps;
}

/**
 * The render worker.
 *
 * Same shape as the ping worker, with two differences that matter:
 *
 * - **Concurrency is low on purpose.** A render is minutes of CPU and hundreds of
 *   megabytes of scratch space, not a millisecond of arithmetic. `WORKER_CONCURRENCY`
 *   is shared with the ping worker, so this one takes `min(concurrency, 2)` and
 *   says so in the log rather than quietly running four renders at once on a
 *   laptop.
 * - **The lock duration is long.** BullMQ renews a job's lock while it is being
 *   processed; a render that takes longer than the lock without a heartbeat is
 *   considered stalled and gets retried by another worker, which is exactly the
 *   double-spend the `assets` array exists to prevent.
 */
export function createRenderWorker(deps: CreateRenderWorkerDeps): RenderWorker {
  const concurrency = Math.max(1, Math.min(deps.concurrency, 2));

  const options: WorkerOptions = {
    connection: deps.connection,
    concurrency,
    lockDuration: 5 * 60_000,
    // The pipeline handles its own stage-level retry by resuming from the failed
    // stage, so BullMQ's attempts are a last resort for a worker that died.
    maxStalledCount: 1,
    prefix: deps.prefix,
  };

  const worker = new Worker<RenderJobData, RenderJobResult, string>(
    QUEUE_NAMES.render,
    createRenderProcessor(deps.render),
    options,
  );

  worker.on('ready', () => {
    deps.logger.info(
      { queue: QUEUE_NAMES.render, job: JOB_NAMES.renderVideo, prefix: deps.prefix, concurrency },
      'render worker ready',
    );
  });

  worker.on('completed', (job, result) => {
    deps.logger.info({ jobId: String(job.id), result }, 'render job completed');
  });

  worker.on('failed', (job, error) => {
    // A stage failure is a *recorded* outcome, not an exception: the job document
    // says which stage and why, and the creator retries from the UI. Logged at
    // warn rather than error so a real crash is still easy to spot.
    deps.logger.warn(
      {
        jobId: job === undefined ? null : String(job.id),
        attemptsMade: job?.attemptsMade,
        err: error,
      },
      'render job reported a failure',
    );
  });

  worker.on('error', (error: Error) => {
    deps.logger.error({ err: error }, 'render worker error');
  });

  worker.on('stalled', (jobId) => {
    deps.logger.warn({ jobId }, 'render job stalled - it will be retried');
  });

  return worker;
}
