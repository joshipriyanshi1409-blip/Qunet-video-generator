import { Button } from '../Button';
import { Badge } from '../Badge';

export interface RenderActionsProps {
  finished: boolean;
  failed: boolean;
  retrying: boolean;
  /** True once the creator has stopped following this render. */
  cancelled: boolean;
  onRetry: () => void;
  onCancel: () => void;
  /** Where "View result" goes - omitted until the job has an MP4. */
  onViewResult?: () => void;
  className?: string;
}

/**
 * Cancel and retry.
 *
 * Both are gated on state rather than always being clickable: a finished render
 * has nothing to cancel, and a running one has nothing to retry. Offering a
 * button that cannot do anything is how a progress screen trains people to
 * distrust it.
 *
 * **Cancel is local.** There is no `DELETE /render/:id` on the API yet, so
 * pressing it stops *this screen* following the job and marks the library entry
 * as cancelled. The worker keeps going - a render nobody is watching still costs
 * the same - and the button says so rather than implying it killed the job.
 */
export function RenderActions({
  finished,
  failed,
  retrying,
  cancelled,
  onRetry,
  onCancel,
  onViewResult,
  className,
}: RenderActionsProps) {
  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-3">
        {finished === true && onViewResult !== undefined ? (
          <Button variant="primary" onClick={onViewResult}>
            View result
          </Button>
        ) : null}

        {failed === true ? (
          <Button variant="primary" loading={retrying} onClick={onRetry}>
            {retrying === true ? 'Retrying…' : 'Retry this stage'}
          </Button>
        ) : null}

        {finished === false ? (
          <Button variant="secondary" onClick={onCancel} disabled={cancelled === true}>
            {cancelled === true ? 'Stopped following' : 'Stop following'}
          </Button>
        ) : null}
      </div>

      {cancelled === true ? (
        <p className="mt-2 text-caption text-ink-500" role="status">
          You are no longer watching this render. The worker keeps going until it
          finishes - stopping the job server-side arrives with the worker.
        </p>
      ) : null}

      {failed === true ? (
        <p className="mt-2 text-caption text-ink-500">
          <Badge tone="warning" compact>
            Retry is safe
          </Badge>{' '}
          Only the failed stage runs again. Every asset the earlier stages produced
          is reused, so a retry costs a fraction of the first attempt.
        </p>
      ) : null}
    </div>
  );
}
