import {
  JOB_NAMES,
  jobStatusResponseSchema,
  pingJobDataSchema,
  QUEUE_NAMES,
  type JobStatusResponse,
  type PingJobPayload,
} from '@creatordna/shared';
import { NotFoundError, ServiceUnavailableError } from '../lib/errors.js';
import type { PingJobData } from '@creatordna/shared';
import type { QueueRegistry } from '../lib/queues.js';
import type { Logger } from 'pino';

export interface EnqueuedJob {
  jobId: string;
  queue: string;
  state: string;
}

export interface PingJobService {
  enqueue(payload: PingJobPayload, uid: string): Promise<EnqueuedJob>;
  getStatus(jobId: string, uid: string): Promise<JobStatusResponse>;
}

export interface PingJobServiceDeps {
  queues: QueueRegistry | null;
  logger: Logger;
}

export function createPingJobService(deps: PingJobServiceDeps): PingJobService {
  const { queues, logger } = deps;

  return {
    async enqueue(payload, uid) {
      if (queues === null) {
        throw new ServiceUnavailableError(
          'service_unavailable',
          'Job queue unavailable (REDIS_ENABLED=false).',
        );
      }

      const data: PingJobData = { ...payload, uid };
      const job = await queues.ping.add(JOB_NAMES.ping, data);
      const state = await job.getState();

      logger.info({ jobId: String(job.id), uid, state }, 'ping job enqueued');

      return { jobId: String(job.id), queue: QUEUE_NAMES.ping, state };
    },

    async getStatus(jobId, uid) {
      if (queues === null) {
        throw new ServiceUnavailableError(
          'service_unavailable',
          'Job queue unavailable (REDIS_ENABLED=false).',
        );
      }

      const job = await queues.ping.getJob(jobId);
      if (job === undefined) {
        throw new NotFoundError(`Job "${jobId}" not found.`);
      }

      // Validate before reading: a job written by an older build may not match.
      const data = pingJobDataSchema.parse(job.data);

      // Never leak another creator's job.
      if (data.uid !== uid) {
        throw new NotFoundError(`Job "${jobId}" not found.`);
      }

      return jobStatusResponseSchema.parse({
        jobId: String(job.id),
        name: job.name,
        state: await job.getState(),
        progress: job.progress,
        attemptsMade: job.attemptsMade,
        // BullMQ leaves `failedReason` undefined for a job that never failed.
        failedReason: job.failedReason ?? null,
        returnvalue: job.returnvalue ?? null,
        data: { ...data },
      });
    },
  };
}
