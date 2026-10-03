import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Badge, type BadgeTone } from '../components/Badge';
import { Button } from '../components/Button';
import { Card, CardContent } from '../components/Card';
import { PageHeader } from '../components/PageHeader';
import { ProgressBar } from '../components/ProgressBar';
import { EmptyState } from '../components/StateViews';
import { useLibrary } from '../hooks/useLibrary';
import {
  DEFAULT_LIBRARY_FILTERS,
  LIBRARY_STATE_LABELS,
  type LibraryItem,
  type LibraryItemState,
} from '../lib/library';
import { cn } from '../lib/cn';

/**
 * Library and history.
 *
 * Every render the creator has made, filterable by state and searchable by title,
 * caption or hashtag. The store is client-side (`lib/library.ts`) because the API
 * does not expose a per-user render listing yet - the page is honest about that
 * rather than pretending to be server-backed.
 */

const STATE_TONES: Record<LibraryItemState, BadgeTone> = {
  running: 'peach',
  completed: 'success',
  failed: 'danger',
  cancelled: 'neutral',
};

const FILTER_OPTIONS: readonly (LibraryItemState | 'all')[] = [
  'all',
  'running',
  'completed',
  'failed',
  'cancelled',
];

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'progress', label: 'Most complete' },
] as const;

export function LibraryPage() {
  const library = useLibrary();
  const filters = library.filters;
  const items = library.filtered;

  const counts = useMemo(() => {
    const tally: Record<string, number> = { all: library.items.length };
    for (const item of library.items) {
      tally[item.state] = (tally[item.state] ?? 0) + 1;
    }
    return tally;
  }, [library.items]);

  return (
    <>
      <PageHeader
        title="Library"
        description="Every render you have made, in one place. Search by title, caption or hashtag."
        actions={<Badge tone="peach">{library.items.length} renders</Badge>}
      />

      <div className="mb-6 space-y-4">
        <div>
          <label htmlFor="library-search" className="sr-only">
            Search your library
          </label>
          <input
            id="library-search"
            type="search"
            value={filters.query}
            onChange={(event) => library.setFilters({ ...filters, query: event.target.value })}
            placeholder="Search by title, caption or hashtag"
            className="h-10 w-full rounded-pill border border-line bg-surface px-4 text-body text-ink-900 placeholder:text-ink-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-peach-600"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-caption font-medium text-ink-500" id="library-state-filter">
            State
          </span>
          <div role="group" aria-labelledby="library-state-filter" className="flex flex-wrap gap-2">
            {FILTER_OPTIONS.map((option) => {
              const active = filters.state === option;
              return (
                <button
                  key={option}
                  type="button"
                  aria-pressed={active}
                  onClick={() => library.setFilters({ ...filters, state: option })}
                  className={cn(
                    'inline-flex h-8 items-center gap-1.5 rounded-pill border px-3 text-caption font-medium transition-colors duration-150',
                    active === true
                      ? 'border-peach-300 bg-peach-100 text-peach-800'
                      : 'border-line bg-surface text-ink-700 hover:bg-peach-50',
                  )}
                >
                  {LIBRARY_STATE_LABELS[option]}
                  <span className="tabular-nums text-ink-500">{counts[option] ?? 0}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="library-sort" className="text-caption font-medium text-ink-500">
            Sort
          </label>
          <select
            id="library-sort"
            value={filters.sort}
            onChange={(event) =>
              library.setFilters({ ...filters, sort: event.target.value as typeof filters.sort })
            }
            className="h-9 rounded-pill border border-line bg-surface px-3 text-caption font-medium text-ink-900"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {items.length === 0 ? (
        <EmptyState
          title={library.items.length === 0 ? 'Your library is empty' : 'Nothing matches those filters'}
          description={
            library.items.length === 0
              ? 'Approve an idea from the Audience Mirror and the finished video lands here automatically.'
              : 'Try a different search, or clear the state filter.'
          }
          action={
            library.items.length === 0 ? (
              <Link
                to="/audience"
                className="inline-flex h-10 items-center rounded-pill border border-line bg-surface px-4 text-body font-medium text-ink-900 hover:bg-peach-50"
              >
                Open the Audience Mirror
              </Link>
            ) : (
              <Button
                variant="secondary"
                onClick={() => library.setFilters({ ...DEFAULT_LIBRARY_FILTERS })}
              >
                Clear filters
              </Button>
            )
          }
        />
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li key={item.jobId}>
              <LibraryCard item={item} onRemove={() => library.remove(item.jobId)} />
            </li>
          ))}
        </ul>
      )}

      <p className="mt-6 text-caption text-ink-500">
        Renders are followed live on their own screen. Your library is stored in this
        browser until the API exposes a per-user render listing.
      </p>
    </>
  );
}

function LibraryCard({ item, onRemove }: { item: LibraryItem; onRemove: () => void }) {
  const to = item.state === 'completed' ? `/render/${item.jobId}/result` : `/render/${item.jobId}`;

  return (
    <Card interactive>
      <CardContent className="flex flex-col gap-4 pt-5 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-body-lg font-semibold text-ink-900">
              <Link to={to} className="hover:text-peach-700 hover:underline hover:underline-offset-4">
                {item.title}
              </Link>
            </h2>
            <Badge tone={STATE_TONES[item.state]} compact>
              {LIBRARY_STATE_LABELS[item.state]}
            </Badge>
            {item.sharedToQoneqt === true ? (
              <Badge tone="info" compact>
                Shared
              </Badge>
            ) : null}
          </div>

          {item.caption.length > 0 ? (
            <p className="mt-1 line-clamp-2 text-caption text-ink-500">{item.caption}</p>
          ) : null}

          <div className="mt-3 max-w-md">
            <ProgressBar value={item.progress} label={`${item.title} progress`} />
          </div>

          {item.hashtags.length > 0 ? (
            <p className="mt-2 text-tiny text-ink-500">{item.hashtags.join(' ')}</p>
          ) : null}

          <p className="mt-2 text-tiny text-ink-300">
            {formatTimestamp(item.updatedAt)} · job {item.jobId}
          </p>
        </div>

        <div className="flex shrink-0 gap-2">
          <Link
            to={to}
            className="inline-flex h-9 items-center rounded-pill bg-peach-500 px-3 text-caption font-medium text-white hover:bg-peach-600"
          >
            {item.state === 'completed' ? 'Open' : 'Follow'}
          </Link>
          <Button variant="ghost" size="sm" onClick={onRemove} aria-label={`Remove ${item.title}`}>
            Remove
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** "3 minutes ago" style, without pulling in a date library for one line. */
function formatTimestamp(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isFinite(then) === false) return 'unknown time';

  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return 'just now';

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;

  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
