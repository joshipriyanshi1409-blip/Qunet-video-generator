import { useHealth } from '../hooks/useHealth';
import { cn } from '../lib/cn';

/**
 * Small live indicator for the API, shown in the sidebar footer.
 * Uses the same `/health` query as the Home screen.
 */
export function ApiStatusPill({ className }: { className?: string }) {
  const { data, isPending, isError } = useHealth();

  const state = isPending === true ? 'checking' : isError === true ? 'down' : 'up';
  const label =
    state === 'checking' ? 'Checking API…' : state === 'down' ? 'API unreachable' : 'API online';

  return (
    <span
      className={cn('inline-flex items-center gap-2 text-caption text-ink-500', className)}
      data-state={state}
    >
      <span
        aria-hidden="true"
        className={cn(
          'size-2 rounded-pill',
          state === 'up' && 'bg-success',
          state === 'down' && 'bg-danger',
          state === 'checking' && 'animate-pulse bg-warning',
        )}
      />
      <span>{label}</span>
      {state === 'up' && data !== undefined ? (
        <span className="text-tiny text-ink-300">redis: {data.checks.redis}</span>
      ) : null}
    </span>
  );
}
