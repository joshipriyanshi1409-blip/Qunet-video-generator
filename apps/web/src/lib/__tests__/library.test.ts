import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LIBRARY_FILTERS,
  LIBRARY_MAX_ITEMS,
  filterLibrary,
  isInLibrary,
  readLibrary,
  removeFromLibrary,
  saveToLibrary,
  updateLibraryItem,
  writeLibrary,
  type LibraryItem,
} from '../library';

/**
 * The library store.
 *
 * Everything here is pure over a `Storage`, so the tests use a real in-memory
 * `Storage` implementation rather than a mock - the interesting failures are a
 * corrupt payload and a store that throws, and both need the real interface.
 */

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
  } as Storage;
}

function item(overrides: Partial<LibraryItem> = {}): LibraryItem {
  return {
    jobId: 'job_1',
    projectId: 'proj_1',
    title: 'POV: binary search finally clicks',
    caption: 'Three days, one bug, zero progress.',
    hashtags: ['#dsa', '#careerswitch'],
    state: 'completed',
    stage: 'completed',
    progress: 100,
    updatedAt: '2026-10-01T10:00:00.000Z',
    source: 'render',
    ...overrides,
  };
}

describe('saveToLibrary', () => {
  it('adds a new entry', () => {
    const storage = memoryStorage();
    const items = saveToLibrary(item(), storage);
    expect(items).toHaveLength(1);
    expect(readLibrary(storage)).toHaveLength(1);
  });

  it('replaces an entry with the same job id instead of duplicating it', () => {
    const storage = memoryStorage();
    saveToLibrary(item({ progress: 40, state: 'running' }), storage);
    saveToLibrary(item({ progress: 100, state: 'completed' }), storage);

    const items = readLibrary(storage);
    expect(items).toHaveLength(1);
    expect(items[0]?.progress).toBe(100);
    expect(items[0]?.state).toBe('completed');
  });

  it('reports whether a job is already saved', () => {
    const storage = memoryStorage();
    expect(isInLibrary('job_1', storage)).toBe(false);
    saveToLibrary(item(), storage);
    expect(isInLibrary('job_1', storage)).toBe(true);
  });
});

describe('updateLibraryItem', () => {
  it('patches one entry and stamps the update time', () => {
    const storage = memoryStorage();
    saveToLibrary(item(), storage);

    const items = updateLibraryItem('job_1', { sharedToQoneqt: true }, storage);

    expect(items[0]?.sharedToQoneqt).toBe(true);
    expect(items[0]?.updatedAt).not.toBe('2026-10-01T10:00:00.000Z');
  });

  it('leaves other entries untouched', () => {
    const storage = memoryStorage();
    saveToLibrary(item({ jobId: 'job_1' }), storage);
    saveToLibrary(item({ jobId: 'job_2' }), storage);

    updateLibraryItem('job_1', { sharedToQoneqt: true }, storage);

    expect(readLibrary(storage).find((entry) => entry.jobId === 'job_2')?.sharedToQoneqt).toBeUndefined();
  });

  it('is a no-op for an unknown job', () => {
    const storage = memoryStorage();
    saveToLibrary(item(), storage);
    const items = updateLibraryItem('job_missing', { progress: 100 }, storage);
    expect(items).toHaveLength(1);
    expect(items[0]?.progress).toBe(100);
  });
});

describe('removeFromLibrary', () => {
  it('drops one entry', () => {
    const storage = memoryStorage();
    saveToLibrary(item({ jobId: 'job_1' }), storage);
    saveToLibrary(item({ jobId: 'job_2' }), storage);

    const items = removeFromLibrary('job_1', storage);

    expect(items.map((entry) => entry.jobId)).toEqual(['job_2']);
  });
});

describe('readLibrary', () => {
  it('returns an empty list when nothing has been written', () => {
    expect(readLibrary(memoryStorage())).toEqual([]);
  });

  it('returns an empty list for a corrupt payload rather than throwing', () => {
    const storage = memoryStorage();
    storage.setItem('creatordna.library.v1', 'not json at all');
    expect(readLibrary(storage)).toEqual([]);
  });

  it('drops entries that are not library items', () => {
    const storage = memoryStorage();
    storage.setItem(
      'creatordna.library.v1',
      JSON.stringify([item(), { jobId: 'broken' }, null, 42]),
    );
    expect(readLibrary(storage)).toHaveLength(1);
  });

  it('survives a store that throws', () => {
    const hostile = {
      getItem: () => {
        throw new Error('storage disabled');
      },
      setItem: () => {
        throw new Error('storage disabled');
      },
    } as unknown as Storage;

    expect(readLibrary(hostile)).toEqual([]);
    expect(() => saveToLibrary(item(), hostile)).not.toThrow();
  });
});

describe('writeLibrary', () => {
  it('trims to the ceiling, keeping the newest', () => {
    const storage = memoryStorage();
    const many = Array.from({ length: LIBRARY_MAX_ITEMS + 5 }, (_, index) =>
      item({
        jobId: `job_${index}`,
        // Padded to a fixed width: ISO strings sort lexicographically, so an
        // unpadded index would make job_104 look older than job_99.
        updatedAt: `2026-10-01T10:${String(index).padStart(4, '0')}.000Z`,
      }),
    );

    writeLibrary(many, storage);

    const stored = readLibrary(storage);
    expect(stored).toHaveLength(LIBRARY_MAX_ITEMS);
    expect(stored[0]?.jobId).toBe(`job_${LIBRARY_MAX_ITEMS + 4}`);
  });
});

describe('filterLibrary', () => {
  const items: LibraryItem[] = [
    item({ jobId: 'job_1', title: 'Binary search', state: 'completed', progress: 100, updatedAt: '2026-10-01T10:00:00.000Z' }),
    item({ jobId: 'job_2', title: 'Recursion drill', state: 'running', progress: 40, updatedAt: '2026-10-02T10:00:00.000Z' }),
    item({ jobId: 'job_3', title: 'Big-O in 30s', state: 'failed', progress: 60, updatedAt: '2026-10-03T10:00:00.000Z' }),
    item({ jobId: 'job_4', title: 'Hash tables', state: 'cancelled', progress: 10, updatedAt: '2026-09-30T10:00:00.000Z' }),
  ];

  it('returns everything by default, newest first', () => {
    const result = filterLibrary(items, DEFAULT_LIBRARY_FILTERS);
    expect(result.map((entry) => entry.jobId)).toEqual(['job_3', 'job_2', 'job_1', 'job_4']);
  });

  it('filters by state', () => {
    const result = filterLibrary(items, { ...DEFAULT_LIBRARY_FILTERS, state: 'completed' });
    expect(result.map((entry) => entry.jobId)).toEqual(['job_1']);
  });

  it('filters by state with nothing matching', () => {
    expect(
      filterLibrary(items, { ...DEFAULT_LIBRARY_FILTERS, state: 'running' }).map((entry) => entry.jobId),
    ).toEqual(['job_2']);
  });

  it('searches the title, case-insensitively', () => {
    const result = filterLibrary(items, { ...DEFAULT_LIBRARY_FILTERS, query: 'RECURSION' });
    expect(result.map((entry) => entry.jobId)).toEqual(['job_2']);
  });

  it('searches the caption', () => {
    const result = filterLibrary(items, { ...DEFAULT_LIBRARY_FILTERS, query: 'one bug' });
    expect(result).toHaveLength(4);
  });

  it('searches the hashtags', () => {
    const result = filterLibrary(items, { ...DEFAULT_LIBRARY_FILTERS, query: '#dsa' });
    expect(result).toHaveLength(4);
  });

  it('combines a query with a state filter', () => {
    const result = filterLibrary(items, {
      ...DEFAULT_LIBRARY_FILTERS,
      query: 'big-o',
      state: 'failed',
    });
    expect(result.map((entry) => entry.jobId)).toEqual(['job_3']);
  });

  it('sorts oldest first', () => {
    const result = filterLibrary(items, { ...DEFAULT_LIBRARY_FILTERS, sort: 'oldest' });
    expect(result[0]?.jobId).toBe('job_4');
  });

  it('sorts by progress', () => {
    const result = filterLibrary(items, { ...DEFAULT_LIBRARY_FILTERS, sort: 'progress' });
    expect(result.map((entry) => entry.jobId)).toEqual(['job_1', 'job_3', 'job_2', 'job_4']);
  });

  it('does not mutate the input', () => {
    const before = items.map((entry) => entry.jobId);
    filterLibrary(items, { ...DEFAULT_LIBRARY_FILTERS, sort: 'oldest' });
    expect(items.map((entry) => entry.jobId)).toEqual(before);
  });
});
