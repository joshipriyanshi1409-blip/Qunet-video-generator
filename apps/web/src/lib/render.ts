import {
  jobStatusResponseSchema,
  renderCreateRequestSchema,
  renderJobAcceptedSchema,
  renderRetryRequestSchema,
  type JobStatusResponse,
  type RenderCreateRequest,
  type RenderJobAccepted,
  type RenderStage,
} from '@creatordna/shared';
import { request } from './api';

/**
 * Render pipeline REST client.
 *
 * Every response is validated with the shared schema, so a backend change that
 * breaks the contract fails loudly in the browser instead of rendering
 * `undefined` into a progress bar the creator is watching.
 */

/** `POST /render` - start the pipeline. Answers `202`, never the finished file. */
export function startRender(input: RenderCreateRequest): Promise<RenderJobAccepted> {
  return request('/api/v1/render', renderJobAcceptedSchema, {
    method: 'POST',
    body: renderCreateRequestSchema.parse(input),
  });
}

/** `GET /render/:id` - the job document: stage, progress, assets, error. */
export function fetchRenderJob(jobId: string): Promise<JobStatusResponse> {
  return request(`/api/v1/render/${encodeURIComponent(jobId)}`, jobStatusResponseSchema);
}

/**
 * `POST /render/:id/retry` - re-run one stage, keeping every earlier asset.
 *
 * `fromStage` is optional and defaults server-side to the stage that failed,
 * which is the only thing a retry may ever do: re-running an earlier stage would
 * spend the creator's money twice for output they already have.
 */
export function retryRenderJob(jobId: string, fromStage?: RenderStage): Promise<RenderJobAccepted> {
  return request(`/api/v1/render/${encodeURIComponent(jobId)}/retry`, renderJobAcceptedSchema, {
    method: 'POST',
    body: renderRetryRequestSchema.parse(fromStage === undefined ? {} : { fromStage }),
  });
}

/**
 * The fields of a job document the render screens read.
 *
 * `jobStatusResponseSchema` is deliberately open (`data` is a record), so the
 * render-specific fields are narrowed here once instead of at every use site.
 */
export interface RenderJobView {
  jobId: string;
  state: JobStatusResponse['state'];
  stage: RenderStage;
  progress: number;
  attemptsMade: number;
  failedReason: string | null;
  assets: JobStatusResponse['assets'];
  error: JobStatusResponse['error'];
  projectId: string | null;
  hook: string | null;
}

/** Narrows a validated job status into the fields the render screens use. */
export function toRenderJobView(status: JobStatusResponse): RenderJobView {
  const data = status.data as Record<string, unknown>;
  const stage = typeof status.stage === 'string' ? (status.stage as RenderStage) : 'queued';

  return {
    jobId: status.jobId,
    state: status.state,
    stage,
    progress: typeof status.progress === 'number' ? status.progress : 0,
    attemptsMade: status.attemptsMade,
    failedReason: status.failedReason,
    assets: status.assets,
    error: status.error,
    projectId: typeof data.projectId === 'string' ? data.projectId : null,
    hook: typeof data.hook === 'string' ? data.hook : null,
  };
}

/** True when the job will not move again on its own. */
export function isTerminalState(state: JobStatusResponse['state']): boolean {
  return state === 'completed' || state === 'failed';
}

/**
 * The MP4 asset on a finished job, if the worker has recorded one.
 *
 * The job document lists assets by kind, so the result page looks for `mp4`
 * rather than guessing a storage path - and says so plainly when it is missing,
 * because a render that "completed" without an MP4 is a bug worth surfacing.
 */
export function findMp4Asset(assets: JobStatusResponse['assets']): JobStatusResponse['assets'][number] | null {
  return assets.find((asset) => asset.kind === 'mp4') ?? null;
}
