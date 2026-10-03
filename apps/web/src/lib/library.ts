import type { RenderStage } from '@creatordna/shared';

/**
 * The creator's library.
 *
 * **This is a client-side store, and that is deliberate.** There is no
 * `GET /render` list endpoint yet - the API owns `renderJobs/{jobId}` but does
 * not expose a per-user listing - so the library persists in `localStorage`
 * rather than pretending to be server state. Everything the screen renders comes
 * from here, and every write is one item.
 *
 * When the listing endpoint arrives, `readLibrary`/`saveToLibrary` are the only
 * two functions that change; the screens keep working.
 */

/**
 * Where the library lives in `localStorage`.
 *
 * Exported so the `storage` listener and the tests agree on one key: a test that
 * seeds a slightly different string silently asserts against an empty library.
 */
export const LIBRARY_STORAGE_KEY = 'creatordna.library.v1';

/** Hard ceiling, so a long-lived browser cannot grow without bound. */
export const LIBRARY_MAX_ITEMS = 200;

export type LibraryItemState = 'running' | 'completed' | 'failed' | 'cancelled';

export interface LibraryItem {
  /** The render job this entry came from. Unique within the library. */
  jobId: string;
  projectId: string;
  /** The hook the creator approved - used as the card title. */
  title: string;
  caption: string;
  hashtags: string[];
  state: LibraryItemState;
  /** Pipeline stage at the time of the last write. */
  stage: RenderStage;
  progress: number;
  /** ISO timestamp of the last write, so sorting is total. */
  updatedAt: string;
  /** Storage URL of the MP4, once the job has one. */
  mp4Url?: string;
  /** The approved script, kept so "Download script" works from the library. */
  script?: string;
  /** Where the entry came from, for the share flow. */
  source: 'render' | 'manual';
  /** Set once the creator has shared it to the Qoneqt feed. */
  sharedToQoneqt?: boolean;
}

export interface LibraryFilters {
  /** Free-text match on title, caption and hashtags. */
  query: string;
  state: LibraryItemState | 'all';
  sort: 'newest' | 'oldest' | 'progress';
}

export const DEFAULT_LIBRARY_FILTERS: LibraryFilters = {
  query: '',
  state: 'all',
  sort: 'newest',
};

/** Reads the library. A corrupt entry degrades to an empty list, never a throw. */
export function readLibrary(storage: Storage = window.localStorage): LibraryItem[] {
  let raw: string | null = null;
  try {
    raw = storage.getItem(LIBRARY_STORAGE_KEY);
  } catch {
    return [];
  }
  if (raw === null) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isLibraryItem);
  } catch {
    return [];
  }
}

/** Writes the library, dropping the oldest entries past the ceiling. */
export function writeLibrary(items: readonly LibraryItem[], storage: Storage = window.localStorage): void {
  const trimmed = [...items]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, LIBRARY_MAX_ITEMS);

  try {
    storage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // A full or disabled storage must not break the screen that is saving.
  }
}

/**
 * Adds or replaces one entry.
 *
 * Replacing by `jobId` is what lets the progress screen update the same card
 * rather than filling the library with a new row every time a stage reports in.
 */
export function saveToLibrary(item: LibraryItem, storage: Storage = window.localStorage): LibraryItem[] {
  const existing = readLibrary(storage);
  const next = [item, ...existing.filter((entry) => entry.jobId !== item.jobId)];
  writeLibrary(next, storage);
  return next;
}

/** Patches one entry, leaving the rest untouched. Returns the whole library. */
export function updateLibraryItem(
  jobId: string,
  patch: Partial<Omit<LibraryItem, 'jobId'>>,
  storage: Storage = window.localStorage,
): LibraryItem[] {
  const existing = readLibrary(storage);
  const next = existing.map((entry) =>
    entry.jobId === jobId ? { ...entry, ...patch, updatedAt: new Date().toISOString() } : entry,
  );
  writeLibrary(next, storage);
  return next;
}

export function removeFromLibrary(jobId: string, storage: Storage = window.localStorage): LibraryItem[] {
  const next = readLibrary(storage).filter((entry) => entry.jobId !== jobId);
  writeLibrary(next, storage);
  return next;
}

/** True when the job is already in the library. */
export function isInLibrary(jobId: string, storage: Storage = window.localStorage): boolean {
  return readLibrary(storage).some((entry) => entry.jobId === jobId);
}

/**
 * Applies the filters.
 *
 * Query matching is case-insensitive across title, caption and hashtags, because
 * a creator looking for "#dsa" should not have to remember the exact casing they
 * typed when they saved it.
 */
export function filterLibrary(items: readonly LibraryItem[], filters: LibraryFilters): LibraryItem[] {
  const query = filters.query.trim().toLowerCase();

  const matched = items.filter((item) => {
    if (filters.state !== 'all' && item.state !== filters.state) return false;
    if (query.length === 0) return true;

    const haystack = [item.title, item.caption, ...item.hashtags].join(' ').toLowerCase();
    return haystack.includes(query);
  });

  return matched.sort((left, right) => {
    switch (filters.sort) {
      case 'oldest':
        return left.updatedAt.localeCompare(right.updatedAt);
      case 'progress':
        return right.progress - left.progress || right.updatedAt.localeCompare(left.updatedAt);
      case 'newest':
      default:
        return right.updatedAt.localeCompare(left.updatedAt);
    }
  });
}

/** Human label for a library state, used by the filter chips. */
export const LIBRARY_STATE_LABELS: Record<LibraryItemState | 'all', string> = {
  all: 'All',
  running: 'In progress',
  completed: 'Ready',
  failed: 'Needs a retry',
  cancelled: 'Cancelled',
};

function isLibraryItem(value: unknown): value is LibraryItem {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.jobId === 'string' &&
    typeof record.title === 'string' &&
    typeof record.updatedAt === 'string' &&
    typeof record.progress === 'number'
  );
}
