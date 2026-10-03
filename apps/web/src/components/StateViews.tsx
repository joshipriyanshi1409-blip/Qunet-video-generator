import type { ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { Button } from './Button';
import { SkeletonText } from './Skeleton';
import { ApiError } from '../lib/api';
import { cn } from '../lib/cn';

/** Loading placeholder with a status message for assistive tech. */
export function LoadingState({ label = 'Loading…', lines = 3, className }: { label?: string; lines?: number; className?: string }) {
  return (
    <div role="status" aria-live="polite" className={cn('space-y-3', className)}>
      <span className="sr-only">{label}</span>
      <SkeletonText lines={lines} />
    </div>
  );
}

export interface EmptyStateProps {
  title: string;
  description?: string;
  /** Primary call to action, e.g. "Start onboarding". */
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}

/** Nothing to show yet - always explain how to get started. */
export function EmptyState({ title, description, action, icon, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-card border border-dashed border-peach-200 bg-surface-muted px-6 py-10 text-center',
        className,
      )}
    >
      <div
        aria-hidden="true"
        className="mb-3 flex size-11 items-center justify-center rounded-pill bg-peach-100 text-peach-600"
      >
        {icon ?? <PlusIcon />}
      </div>
      <h3 className="text-body-lg font-semibold text-ink-900">{title}</h3>
      {description === undefined ? null : (
        <p className="mt-1 max-w-sm text-caption text-ink-500">{description}</p>
      )}
      {action === undefined ? null : <div className="mt-4">{action}</div>}
    </div>
  );
}

export interface ErrorStateProps {
  error: unknown;
  onRetry?: () => void;
  className?: string;
}

/** Failed request - always offer a retry. */
export function ErrorState({ error, onRetry, className }: ErrorStateProps) {
  const message =
    error instanceof ApiError
      ? error.message
      : error instanceof Error
        ? error.message
        : 'Something went wrong.';

  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-start gap-3 rounded-card border border-danger-soft bg-danger-soft px-5 py-4',
        className,
      )}
    >
      <div>
        <h3 className="text-body font-semibold text-danger-strong">Could not load this</h3>
        <p className="mt-1 text-caption text-danger-strong/90">{message}</p>
      </div>
      {onRetry === undefined ? null : (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export interface QueryBoundaryProps<TData> {
  query: UseQueryResult<TData>;
  /** Render the loaded data. */
  children: (data: TData) => ReactNode;
  /** Treat the loaded data as "nothing yet" (e.g. an empty list). */
  isEmpty?: (data: TData) => boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
  loadingLabel?: string;
  className?: string;
}

/**
 * Wraps a TanStack Query result in loading / error / empty / success states so
 * every screen behaves the same way.
 */
export function QueryBoundary<TData>({
  query,
  children,
  isEmpty,
  emptyTitle = 'Nothing here yet',
  emptyDescription,
  emptyAction,
  loadingLabel,
  className,
}: QueryBoundaryProps<TData>) {
  if (query.isPending === true) {
    return <LoadingState label={loadingLabel} className={className} />;
  }

  if (query.isError === true) {
    return (
      <ErrorState
        error={query.error}
        onRetry={() => void query.refetch()}
        className={className}
      />
    );
  }

  const data = query.data;
  if (data === undefined) {
    return (
      <EmptyState
        title={emptyTitle}
        description={emptyDescription}
        action={emptyAction}
        className={className}
      />
    );
  }

  if (isEmpty !== undefined && isEmpty(data) === true) {
    return (
      <EmptyState
        title={emptyTitle}
        description={emptyDescription}
        action={emptyAction}
        className={className}
      />
    );
  }

  return <>{children(data)}</>;
}

function PlusIcon() {
  return (
    <svg className="size-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
