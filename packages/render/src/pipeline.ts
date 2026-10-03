import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  RENDER_STAGES,
  renderCreateRequestSchema,
  stageProgress,
  storyboardSchema,
  type RenderAsset,
  type RenderProgressEvent,
  type RenderStage,
  type Storyboard,
} from '@creatordna/shared';
import type { Logger } from 'pino';
import type { RenderAi } from './ai.js';
import type { Composer } from './composers.js';
import type { RenderJobRepository } from './repository.js';
import type { RenderEventPublisher } from './events.js';
import { createStages, createWorkArea, type StageRunner, type WorkStage } from './stages.js';
import type { AssetStore } from './storage.js';

/**
 * The render pipeline runner.
 *
 * Owns everything a stage must not: reading the job document, deciding where to
 * resume, reporting progress, recording assets, and turning a stage failure into
 * a document a creator can act on.
 *
 * **Resume is the whole design.** The API re-queues a failed job with
 * `stage` set to the stage that failed. This runner starts there, and each stage
 * additionally skips itself when its asset is already on the job - so a retry
 * that lands mid-pipeline does not spend the creator's money twice.
 */

export interface PipelineDeps {
  repository: RenderJobRepository;
  store: AssetStore;
  ai: RenderAi;
  /** Present when the AI has a caption model; used only to label the log line. */
  captionModel?: string;
  composer: Composer;
  logger: Logger;
  /** Publishes progress to the browser. Null when Redis pub/sub is off. */
  events?: RenderEventPublisher | null;
  /** Scratch directory for per-job working files. */
  workRoot: string;
  width?: number;
  height?: number;
}

export interface PipelineResult {
  jobId: string;
  stage: 'completed' | 'failed';
  message: string;
  outputPath?: string;
  /** Stages that actually ran, for the log. */
  ran: readonly WorkStage[];
  /** Stages skipped because their assets were already on the job. */
  skipped: readonly WorkStage[];
}

/**
 * Thrown by a stage so the pipeline can record which stage and why.
 *
 * `retryable` is set by the stage, not guessed from the message. A model timing
 * out is worth another attempt; a script that breaks a cost limit is not, and a
 * pipeline that infers the difference from prose eventually guesses wrong.
 */
export class StageFailure extends Error {
  override readonly cause?: unknown;
  readonly retryable: boolean;

  constructor(
    readonly stage: WorkStage,
    message: string,
    options: { cause?: unknown; retryable?: boolean } = {},
  ) {
    super(message);
    this.name = 'StageFailure';
    this.cause = options.cause;
    this.retryable = options.retryable ?? true;
  }
}

/**
 * Runs one render job to completion, or to a recorded failure.
 *
 * It never throws for a stage failure: the caller (the BullMQ processor) gets a
 * `PipelineResult` and can decide whether BullMQ should retry. Throwing here
 * would lose the stage name, and "the job failed" without a stage is a message
 * nobody can act on.
 */
export async function runRenderPipeline(
  deps: PipelineDeps,
  jobId: string,
): Promise<PipelineResult> {
  const { repository, logger } = deps;

  const job = await repository.get(jobId);
  if (job === null) {
    // Nothing to resume and nothing to report against. The API's own 404 path
    // covers the user-visible case; this is the worker discovering a job the
    // document never had.
    return {
      jobId,
      stage: 'failed',
      message: 'No job document was found for this render, so there is nothing to run.',
      ran: [],
      skipped: [],
    };
  }

  const payload = renderCreateRequestSchema.parse(job.payload);

  // A job that already finished must never be re-run. BullMQ re-queues a job
  // whose processor threw *after* the work succeeded, and without this guard that
  // would regenerate every asset the creator already has.
  if (job.state === 'completed' && job.stage === 'completed') {
    logger.debug({ jobId }, 'render job already completed - nothing to do');
    return {
      jobId,
      stage: 'completed',
      message: 'This render already finished.',
      outputPath: job.assets.find((asset) => asset.kind === 'mp4')?.storagePath,
      ran: [],
      skipped: [],
    };
  }

  const stages = createStages({
    store: deps.store,
    ai: deps.ai,
    captionModel: deps.captionModel,
    composer: deps.composer,
    logger,
    width: deps.width,
    height: deps.height,
  });

  const workDir = join(deps.workRoot, jobId);
  await mkdir(workDir, { recursive: true });
  const work = createWorkArea(workDir);

  // `RENDER_STAGES` is typed as the full stage enum because the shared plan is
  // declared that way; the filter narrows it to the eight that do work without
  // changing the runtime order.
  const workStages = RENDER_STAGES.filter(
    (stage): stage is WorkStage =>
      stage !== 'queued' && stage !== 'completed' && stage !== 'failed',
  );

  // Where to start. Normally the stage the job is recorded as being on, which is
  // what a retry sets. When the recorded stage is not one of the eight - a job
  // that failed before any stage ran, or one written by an older build - fall
  // back to the first stage whose asset is not already on the job, so a re-run
  // resumes rather than restarts.
  const recorded = workStages.indexOf(job.stage as WorkStage);
  const startIndex =
    recorded >= 0
      ? recorded
      : workStages.findIndex((stage) => stages[stage].alreadyDone(job.assets) === false);

  const ran: WorkStage[] = [];
  const skipped: WorkStage[] = [];
  let assets: RenderAsset[] = [...job.assets];
  let storyboard: Storyboard | null = await loadStoryboard(deps, assets);

  const publish = async (event: Omit<RenderProgressEvent, 'type' | 'jobId'>): Promise<void> => {
    await deps.events?.publish({ type: 'render.progress', jobId, ...event });
  };

  // Mark the job active before the first stage, so a creator who opens the
  // screen mid-flight sees something rather than an empty card.
  await publish({ stage: workStages[startIndex] ?? 'script', progress: job.progress });

  for (let index = startIndex; index < workStages.length; index += 1) {
    const stage = workStages[index];
    if (stage === undefined) continue;

    const runner: StageRunner = stages[stage];

    // Belt and braces: the resume point already skips earlier stages, and this
    // catches the case where a stage's asset survived a crash mid-run.
    if (index > startIndex && runner.alreadyDone(assets)) {
      skipped.push(stage);
      logger.debug({ jobId, stage }, 'stage skipped - its asset is already on the job');
      continue;
    }

    ran.push(stage);

    const commit = async (stage_: WorkStage, progress: number, message?: string): Promise<void> => {
      await repository.update(jobId, {
        stage: stage_,
        progress,
        state: 'active',
        error: null,
        assets,
      });
      await publish({ stage: stage_, progress, message });
    };

    await commit(stage, stageProgressFor(stage, 0), `${stage} started`);

    try {
      const outcome = await runner.run(
        {
          job: { ...job, assets, stage },
          payload,
          storyboard,
          assets,
          work,
          readAsset: (asset) => deps.store.read(asset.storagePath),
        },
        async (fraction, message) => {
          await commit(stage, stageProgressFor(stage, fraction), message);
        },
      );

      if (outcome.assets.length > 0) {
        // Replace by kind+scene rather than appending: a re-run of a stage must
        // not leave two clips for scene 3 on the document.
        assets = mergeAssets(assets, outcome.assets);
      }
      if (outcome.storyboard !== undefined) storyboard = outcome.storyboard;

      await commit(stage, stageProgressFor(stage, 1), outcome.skippedReason);
    } catch (error) {
      const failure =
        error instanceof StageFailure
          ? error
          : new StageFailure(stage, error instanceof Error ? error.message : String(error), {
              cause: error,
            });

      const attempts = job.attemptsMade + 1;
      await repository.update(jobId, {
        stage: failure.stage,
        state: 'failed',
        error: {
          stage: failure.stage,
          message: failure.message,
          attempts,
          retryable: failure.retryable,
        },
        assets,
      });
      await publish({ stage: failure.stage, progress: stageProgressFor(failure.stage, 0) });

      logger.warn(
        { jobId, stage: failure.stage, err: failure.cause ?? failure },
        'render stage failed',
      );

      return {
        jobId,
        stage: 'failed',
        message: failure.message,
        ran,
        skipped,
      };
    }
  }

  const mp4 = assets.find((asset) => asset.kind === 'mp4');
  await repository.update(jobId, {
    stage: 'completed',
    state: 'completed',
    progress: 100,
    error: null,
    assets,
  });
  await publish({ stage: 'completed', progress: 100, message: 'Your video is ready' });

  logger.info({ jobId, ran, skipped, output: mp4?.url ?? mp4?.storagePath }, 'render complete');

  // Scratch files are re-derivable from the store; leaving them behind is how a
  // disk fills up quietly over a few hundred renders.
  await rm(workDir, { recursive: true, force: true }).catch(() => undefined);

  return {
    jobId,
    stage: 'completed',
    message: 'Render finished.',
    outputPath: mp4?.storagePath,
    ran,
    skipped,
  };
}

/** Reads the storyboard back off the job, or null when it is not there yet. */
async function loadStoryboard(
  deps: PipelineDeps,
  assets: readonly RenderAsset[],
): Promise<Storyboard | null> {
  const asset = assets.find((entry) => entry.kind === 'storyboard');
  if (asset === undefined) return null;
  const bytes = await deps.store.read(asset.storagePath);
  if (bytes === null) return null;
  try {
    return storyboardSchema.parse(JSON.parse(bytes.toString('utf8')));
  } catch {
    return null;
  }
}

/**
 * Merges new assets into the list, replacing by `kind` + `sceneIndex`.
 *
 * Appending would accumulate duplicates across a retry, and the result page
 * picks the *last* MP4 - so a stale clip from an earlier attempt could win.
 */
export function mergeAssets(
  existing: readonly RenderAsset[],
  produced: readonly RenderAsset[],
): RenderAsset[] {
  const merged = [...existing];
  for (const asset of produced) {
    const index = merged.findIndex(
      (entry) => entry.kind === asset.kind && entry.sceneIndex === asset.sceneIndex,
    );
    if (index >= 0) merged[index] = asset;
    else merged.push(asset);
  }
  return merged;
}

/** Progress for a stage part-way through, from the shared weighted plan. */
function stageProgressFor(stage: RenderStage, fraction: number): number {
  return stageProgress(stage, fraction);
}
