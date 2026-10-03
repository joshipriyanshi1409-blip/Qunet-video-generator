import { Queue } from 'bullmq';
import {
  QUEUE_NAMES,
  type PingJobData,
  type PingJobResult,
  type RenderJobData,
  type RenderJobResult,
} from '@creatordna/shared';
import type { Logger } from 'pino';
import type { AppConfig } from '../config/index.js';
import { redisOptions } from './redis.js';

export type PingQueue = Queue<PingJobData, PingJobResult, string>;
export type RenderQueue = Queue<RenderJobData, RenderJobResult, string>;

export interface QueueRegistry {
  readonly ping: PingQueue;
  readonly render: RenderQueue;
  close(): Promise<void>;
}

/**
 * Creates the BullMQ queues the API *produces* to.
 *
 * The API never processes jobs (engineering rule 5) - it only enqueues them.
 * Returns `null` when Redis is disabled so `/health` and the rest of the API keep
 * working.
 */
export function createQueues(config: AppConfig, logger: Logger): QueueRegistry | null {
  if (!config.env.REDIS_ENABLED) {
    logger.info('bullmq queues disabled (REDIS_ENABLED=false)');
    return null;
  }

  const connection = redisOptions(config);

  const ping = new Queue<PingJobData, PingJobResult, string>(QUEUE_NAMES.ping, {
    connection,
    prefix: config.env.QUEUE_PREFIX,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: { age: 86_400 },
    },
  });

  const render = new Queue<RenderJobData, RenderJobResult, string>(QUEUE_NAMES.render, {
    connection,
    prefix: config.env.QUEUE_PREFIX,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: { age: 86_400 },
    },
  });

  ping.on('error', (error: Error) => {
    logger.error({ err: error, queue: QUEUE_NAMES.ping }, 'bullmq queue error');
  });
  render.on('error', (error: Error) => {
    logger.error({ err: error, queue: QUEUE_NAMES.render }, 'bullmq queue error');
  });

  logger.info(
    {
      queues: [QUEUE_NAMES.ping, QUEUE_NAMES.render],
      prefix: config.env.QUEUE_PREFIX,
      redis: config.env.REDIS_URL,
    },
    'bullmq queues ready',
  );

  return {
    ping,
    render,
    close: async () => {
      await ping.close();
      await render.close();
    },
  };
}

export async function closeQueues(queues: QueueRegistry | null): Promise<void> {
  if (queues === null) return;
  await queues.close();
}
