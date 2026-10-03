import type { Job } from 'bullmq';
import type { PingJobData, PingJobResult } from '@creatordna/shared';
import type { Logger } from 'pino';

export interface PingJobDeps {
  /** Injectable so tests never wait on real timers. */
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
  logger: Logger;
}

export type PingJobProcessor = (
  job: Job<PingJobData, PingJobResult, string>,
) => Promise<PingJobResult>;

/**
 * Demo job that proves the whole queue -> worker -> Redis round trip.
 *
 * It also demonstrates the two behaviours the real render pipeline needs:
 * progress reporting (so the UI can show live stage progress) and retries that
 * only re-run the failed attempt.
 */
export function createPingProcessor(deps: PingJobDeps): PingJobProcessor {
  const { sleep, now, logger } = deps;

  return async function processPing(job) {
    const { message, delayMs, failFirstAttempts } = job.data;
    // `attemptsMade` counts attempts *before* this one.
    const attempt = job.attemptsMade + 1;

    logger.debug({ jobId: String(job.id), attempt }, 'ping job started');

    if (attempt <= failFirstAttempts) {
      throw new Error(`Simulated failure (attempt ${attempt} of ${failFirstAttempts})`);
    }

    await job.updateProgress(10);

    if (delayMs > 0) {
      await sleep(delayMs);
    }

    await job.updateProgress(60);
    await job.updateProgress(100);

    return {
      message,
      finishedAt: now().toISOString(),
      attempts: attempt,
    };
  };
}
