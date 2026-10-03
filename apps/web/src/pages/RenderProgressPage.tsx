import { Link, useNavigate, useParams } from 'react-router-dom';
import { Badge } from '../components/Badge';
import { Card, CardContent } from '../components/Card';
import { PageHeader } from '../components/PageHeader';
import { ProgressBar } from '../components/ProgressBar';
import { ProgressRing } from '../components/ProgressRing';
import { EmptyState, ErrorState, LoadingState } from '../components/StateViews';
import { EtaBadge } from '../components/render/EtaBadge';
import { RenderActions } from '../components/render/RenderActions';
import { StageStepper } from '../components/render/StageStepper';
import { useRenderJob, stageHeadline } from '../hooks/useRenderJob';
import { findMp4Asset } from '../lib/render';
import { uiStageIndex } from '../lib/renderStages';
import { ApiError } from '../lib/api';

/**
 * Render progress.
 *
 * Driven by the WebSocket, with polling as the safety net. What the screen owes
 * the creator is the truth about where the job is: which step is running, how far
 * through it, roughly how long is left, and - when something breaks - exactly
 * what failed and what a retry will and will not redo.
 */
export function RenderProgressPage() {
  const { jobId = '' } = useParams();
  const navigate = useNavigate();
  const render = useRenderJob(jobId.length > 0 ? jobId : null);

  if (jobId.length === 0) {
    return (
      <>
        <PageHeader title="Render progress" description="No job selected." />
        <EmptyState
          title="No render selected"
          description="Approve an idea from the Audience Mirror and the job appears here with live progress."
          action={
            <Link
              to="/audience"
              className="inline-flex h-10 items-center rounded-pill border border-line bg-surface px-4 text-body font-medium text-ink-900 hover:bg-peach-50"
            >
              Open the Audience Mirror
            </Link>
          }
        />
      </>
    );
  }

  if (render.isLoading === true) {
    return (
      <>
        <PageHeader title="Render progress" description="Reading the job…" />
        <LoadingState label="Reading the render job…" lines={5} />
      </>
    );
  }

  if (render.error !== null && render.job === null) {
    const unavailable =
      render.error instanceof ApiError &&
      (render.error.status === 503 || render.error.code === 'service_unavailable');

    return (
      <>
        <PageHeader title="Render progress" description="This job could not be read." />
        <ErrorState error={render.error} onRetry={render.refetch} className="mb-6" />
        {unavailable === true ? (
          <Card>
            <CardContent>
              <p className="text-caption text-ink-700">
                The job queue is not running, so no render can start. Start Redis and
                restart the API, then approve again.
              </p>
            </CardContent>
          </Card>
        ) : null}
      </>
    );
  }

  const job = render.job;
  const stageIndex = uiStageIndex(render.stage);
  const headline = stageHeadline(render.stage, render.failed);
  const mp4 = job === null ? null : findMp4Asset(job.assets);
  const failure = job?.error ?? null;

  return (
    <>
      <PageHeader
        title="Render progress"
        description="Runs in the background with live progress. A failed stage retries on its own and reuses every cached asset."
        actions={
          <Badge
            tone={render.failed === true ? 'danger' : render.finished === true ? 'success' : 'peach'}
          >
            {render.failed === true
              ? 'Failed'
              : render.finished === true
                ? 'Ready'
                : render.live === true
                  ? 'Live'
                  : 'Polling'}
          </Badge>
        }
      />

      <Card className="mb-6">
        <CardContent className="flex flex-col items-center gap-6 pt-6 sm:flex-row sm:items-start">
          <ProgressRing value={render.progress} label="Render progress" size={128} thickness={10} />

          <div className="min-w-0 flex-1">
            <h2 className="text-title font-semibold text-ink-900">{headline}</h2>
            <p className="mt-1 text-body text-ink-500">
              {render.message ?? 'Waiting for the next stage to report in.'}
            </p>

            <div className="mt-4">
              <ProgressBar value={render.progress} label="Overall render progress" />
            </div>

            <dl className="mt-4 grid grid-cols-2 gap-3 text-caption sm:grid-cols-4">
              <div>
                <dt className="text-ink-500">Job</dt>
                <dd className="truncate font-medium text-ink-900" title={jobId}>
                  {jobId}
                </dd>
              </div>
              <div>
                <dt className="text-ink-500">State</dt>
                <dd className="font-medium text-ink-900">{job?.state ?? render.stage}</dd>
              </div>
              <div>
                <dt className="text-ink-500">Attempts</dt>
                <dd className="font-medium text-ink-900">{job?.attemptsMade ?? 0}</dd>
              </div>
              <div>
                <dt className="text-ink-500">Project</dt>
                <dd className="truncate font-medium text-ink-900" title={job?.projectId ?? ''}>
                  {job?.projectId ?? 'n/a'}
                </dd>
              </div>
            </dl>

            <div className="mt-5 border-t border-line pt-4">
              <EtaBadge estimate={render.eta} />
            </div>
          </div>
        </CardContent>
      </Card>

      {render.failed === true && failure !== null ? (
        <Card className="mb-6 border-danger-soft bg-danger-soft">
          <CardContent>
            <h2 className="text-body font-semibold text-danger-strong">
              The {failure.stage} stage failed
            </h2>
            <p className="mt-1 text-caption text-danger-strong/90">{failure.message}</p>
            <p className="mt-2 text-caption text-danger-strong/90">
              Attempt {failure.attempts + 1}. Assets already on the job are kept, so a
              retry starts from the stage that broke rather than from the beginning.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <section aria-labelledby="stages-heading" className="mb-6">
        <h2 id="stages-heading" className="mb-3 text-body-lg font-semibold text-ink-900">
          Pipeline
        </h2>
        <StageStepper currentIndex={stageIndex} progress={render.progress} failed={render.failed} />
      </section>

      <RenderActions
        finished={render.finished}
        failed={render.failed}
        retrying={render.retrying}
        cancelled={render.cancelled}
        onRetry={() => void render.retry()}
        onCancel={render.cancel}
        onViewResult={
          render.finished === true && mp4 !== null
            ? () => void navigate(`/render/${jobId}/result`)
            : undefined
        }
      />

      {render.finished === true && mp4 === null ? (
        <Card className="mt-6">
          <CardContent>
            <h2 className="text-body font-semibold text-ink-900">Finished, but no video yet</h2>
            <p className="mt-1 text-caption text-ink-500">
              The job reached its final stage without recording an MP4 asset. That is a
              gap in the pipeline rather than something you did - the worker's output
              stage is what writes the file and records it on the job.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <p className="mt-6 text-caption text-ink-500">
        Looking for something else?{' '}
        <Link to="/library" className="text-peach-700 underline underline-offset-4">
          Open your library
        </Link>
        .
      </p>
    </>
  );
}
