import {
  QUEUE_NAMES,
  JOB_NAMES,
  jobStatusResponseSchema,
  renderJobDataSchema,
  renderJobSchema,
  type CreatorDna,
  type JobStatusResponse,
  type RenderCreateRequest,
  type RenderJob,
  type RenderJobAccepted,
  type RenderProgressEvent,
  type RenderStage,
} from '@creatordna/shared';
import { isRetryableStage, stageProgress } from '@creatordna/shared';
import { AppError, NotFoundError, ServiceUnavailableError } from '../lib/errors.js';
import type { RenderJobRepository } from '../lib/renderJobRepository.js';
import type { RenderEventPublisher } from '../lib/renderEvents.js';
import type { QueueRegistry } from '../lib/queues.js';
import type { Logger } from 'pino';

/**
 * Render jobs.
 *
 * The API only ever *produces* to the render queue (engineering rule 5: heavy
 * work runs in the worker). What it does own is the job document: creating it,
 * reporting progress into it, and re-queueing a failed stage without throwing
 * away the assets the stages before it already produced.
 */
export interface RenderJobService {
  /** Creates the queue job and its document together. */
  create(payload: RenderCreateRequest, uid: string): Promise<RenderJobAccepted>;
  /** Reads the document, falling back to the queue for a job with no document. */
  getStatus(jobId: string, uid: string): Promise<JobStatusResponse>;
  /** Re-runs the failed stage, keeping every asset already on the job. */
  retry(jobId: string, uid: string, fromStage?: RenderStage): Promise<RenderJobAccepted>;
  /** Records progress on the document and pushes it to subscribed browsers. */
  reportProgress(event: RenderProgressEvent): Promise<void>;
  /** The document as stored, for tests and the worker. */
  read(jobId: string): Promise<RenderJob | null>;
}

export interface RenderJobServiceDeps {
  queues: QueueRegistry | null;
  repository: RenderJobRepository;
  logger: Logger;
  /** Null when Redis pub/sub is off: progress still lands on the document. */
  events?: RenderEventPublisher | null;
  /**
   * Reads the creator's profile so it can be snapshotted onto the job.
   *
   * Optional because a render is still valid with no DNA - the storyboard
   * prompt then says `unknown` for each field instead of inventing a voice. It
   * is read *here*, at accept time, rather than in the worker, so a retry three
   * weeks from now produces the same video it would have produced today.
   */
  dnaRepository?: { get(uid: string): Promise<CreatorDna | null> } | null;
}

export function createRenderJobService(deps: RenderJobServiceDeps): RenderJobService {
  const { queues, repository, logger, events, dnaRepository } = deps;

  function requireQueues(): QueueRegistry {
    if (queues === null) {
      throw new ServiceUnavailableError(
        'service_unavailable',
        'Job queue unavailable (REDIS_ENABLED=false).',
      );
    }
    return queues;
  }

  /** Writes the document and, when there is a bus, tells the browser. */
  async function commit(job: RenderJob): Promise<RenderJob> {
    const saved = await repository.save({ ...job, updatedAt: new Date().toISOString() });
    await events?.publish({
      type: 'render.progress',
      jobId: saved.jobId,
      stage: saved.stage,
      progress: saved.progress,
    });
    return saved;
  }

  return {
    async create(payload, uid) {
      const registry = requireQueues();
      const data = renderJobDataSchema.parse({ ...payload, uid });

      const job = await registry.render.add(JOB_NAMES.renderVideo, data);
      const jobId = String(job.id);
      const state = await job.getState();

      // Snapshot the profile the script was written against. A failure to read
      // it must not lose the render the creator already paid for, so a store
      // error degrades to `null` and the storyboard says `unknown`.
      let dna: CreatorDna | null = null;
      if (dnaRepository != null) {
        try {
          dna = await dnaRepository.get(uid);
        } catch (error) {
          logger.warn({ err: error, uid, jobId }, 'could not read the DNA profile for this render');
        }
      }

      await commit(
        renderJobSchema.parse({
          jobId,
          uid,
          queue: QUEUE_NAMES.render,
          state,
          stage: 'queued',
          progress: 0,
          assets: [],
          error: null,
          attemptsMade: 0,
          dna,
          // Kept on the document, not only in the queue: a retry days later must
          // still know what it was rendering.
          payload: { ...data },
          createdAt: new Date().toISOString(),
        }),
      );

      logger.info(
        { jobId, uid, projectId: data.projectId, state, dnaVersion: dna?.dnaVersion ?? null },
        'render job created',
      );

      return {
        jobId,
        queue: QUEUE_NAMES.render,
        state,
        stage: 'queued',
        progress: 0,
        resumedFromAssets: false,
      };
    },

    async getStatus(jobId, uid) {
      const document = await repository.get(jobId);

      // The document is authoritative: it carries the stage and the assets,
      // which the queue knows nothing about.
      if (document !== null) {
        // Never leak another creator's job.
        if (document.uid !== uid) throw new NotFoundError(`Job "${jobId}" not found.`);

        const job = queues === null ? undefined : await queues.render.getJob(jobId);
        return jobStatusResponseSchema.parse({
          jobId: document.jobId,
          name: JOB_NAMES.renderVideo,
          // The queue owns "waiting / active / completed / failed" and keeps it
          // current; the document's own copy is only there for the moment the
          // queue evicts the job.
          state: job === undefined ? document.state : await job.getState(),
          progress: document.progress,
          attemptsMade: document.attemptsMade,
          failedReason: document.error?.message ?? null,
          returnvalue: null,
          data: document.payload,
          stage: document.stage,
          assets: document.assets,
          error: document.error,
        });
      }

      // No document, and no queue to ask either: there is nothing to report.
      // Answering 503 here would turn every unknown job id into "try again
      // later", which is a lie the caller cannot act on.
      if (queues === null) {
        throw new NotFoundError(`Job "${jobId}" not found.`);
      }

      // No document yet: fall back to the queue so a job enqueued by an older
      // build still reports something honest.
      const registry = requireQueues();
      const job = await registry.render.getJob(jobId);
      if (job === undefined) throw new NotFoundError(`Job "${jobId}" not found.`);

      const data = renderJobDataSchema.parse(job.data);
      if (data.uid !== uid) throw new NotFoundError(`Job "${jobId}" not found.`);

      return jobStatusResponseSchema.parse({
        jobId: String(job.id),
        name: job.name,
        state: await job.getState(),
        progress: job.progress,
        attemptsMade: job.attemptsMade,
        failedReason: job.failedReason ?? null,
        returnvalue: job.returnvalue ?? null,
        data: { ...data },
      });
    },

    async retry(jobId, uid, fromStage) {
      const document = await repository.get(jobId);
      if (document === null) throw new NotFoundError(`Job "${jobId}" not found.`);
      if (document.uid !== uid) throw new NotFoundError(`Job "${jobId}" not found.`);

      const registry = requireQueues();

      // A retry re-runs the stage that failed. Anything earlier already has an
      // asset on the job, and re-running it would spend the creator's money
      // twice for output they already have.
      const stage = fromStage ?? document.stage;
      if (isRetryableStage(stage) === false) {
        throw new AppError(
          400,
          'stage_not_retryable',
          `Stage "${stage}" cannot be retried on its own - retry the render, or ask for a stage that has not finished.`,
        );
      }

      // The old queue entry has to go first: BullMQ will not re-add a job under
      // a job id that still exists, so a retry would otherwise silently do
      // nothing while the API reported success.
      const previous = await registry.render.getJob(jobId);
      if (previous !== undefined) await previous.remove().catch(() => undefined);

      const data = renderJobDataSchema.parse({ ...document.payload, uid });
      await registry.render.add(JOB_NAMES.renderVideo, data, { jobId });

      const updated = await commit(
        renderJobSchema.parse({
          ...document,
          state: 'waiting',
          stage,
          progress: stageProgress(stage, 0),
          error: null,
          attemptsMade: document.attemptsMade + 1,
        }),
      );

      logger.info(
        {
          jobId,
          uid,
          stage,
          reusedAssets: document.assets.length,
          attemptsMade: updated.attemptsMade,
        },
        'render job stage re-queued',
      );

      return {
        jobId,
        queue: QUEUE_NAMES.render,
        state: updated.state,
        stage: updated.stage,
        progress: updated.progress,
        resumedFromAssets: document.assets.length > 0,
      };
    },

    async reportProgress(event) {
      const document = await repository.get(event.jobId);
      if (document === null) return;

      await commit(
        renderJobSchema.parse({
          ...document,
          stage: event.stage,
          progress: event.progress,
          state: event.stage === 'completed' ? 'completed' : document.state,
        }),
      );
    },

    async read(jobId) {
      return repository.get(jobId);
    },
  };
}
