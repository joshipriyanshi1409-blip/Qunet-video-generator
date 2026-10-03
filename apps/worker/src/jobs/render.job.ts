import type { Job } from 'bullmq';
import {
  renderJobDataSchema,
  renderJobResultSchema,
  type RenderJobData,
  type RenderJobResult,
} from '@creatordna/shared';
import { runRenderPipeline, type RenderEventPublisher } from '@creatordna/render';
import type { RenderJobDeps } from '../lib/renderDeps.js';

/**
 * The render job processor.
 *
 * The pipeline itself lives in `@creatordna/render`; this file is only the bridge
 * between BullMQ and it, plus the one decision that matters:
 *
 * **The processor never throws for a stage failure.** BullMQ retries a job whose
 * processor throws, re-running it from the top - which for a render would mean
 * regenerating clips the creator already paid for. So a stage failure comes back
 * as a `RenderJobResult` with `stage: 'failed'`, and BullMQ's own attempts are
 * reserved for the case where the worker died before writing anything at all.
 */

export type RenderJobProcessor = (
  job: Job<RenderJobData, RenderJobResult, string>,
) => Promise<RenderJobResult>;

export function createRenderProcessor(deps: RenderJobDeps): RenderJobProcessor {
  const { logger } = deps;

  return async function processRender(job) {
    // The API enqueued this; parsing again is cheap, and a job written by an
    // older build fails here with a readable message rather than three stages in.
    const data = renderJobDataSchema.parse(job.data);
    const jobId = String(job.id);

    logger.info(
      { jobId, uid: data.uid, projectId: data.projectId, attempt: job.attemptsMade + 1 },
      'render job picked up',
    );

    const result = await runRenderPipeline(
      {
        repository: deps.repository,
        store: deps.store,
        ai: deps.ai,
        captionModel: deps.captionModel,
        composer: deps.composer,
        logger,
        events: deps.events as RenderEventPublisher | null,
        workRoot: deps.workRoot,
        width: deps.width,
        height: deps.height,
      },
      jobId,
    );

    // Progress on the queue entry itself, so a dashboard watching BullMQ sees the
    // same 100/0 the job document records.
    await job.updateProgress(result.stage === 'completed' ? 100 : 0);

    logger.info(
      { jobId, stage: result.stage, ran: result.ran, skipped: result.skipped },
      result.stage === 'completed' ? 'render job finished' : 'render job failed',
    );

    return renderJobResultSchema.parse({
      stage: result.stage,
      message: result.message,
      outputPath: result.outputPath,
    });
  };
}
