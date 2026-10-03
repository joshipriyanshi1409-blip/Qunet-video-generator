import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_LIBRARY_FILTERS,
  LIBRARY_STORAGE_KEY,
  filterLibrary,
  readLibrary,
  removeFromLibrary,
  saveToLibrary,
  updateLibraryItem,
  type LibraryFilters,
  type LibraryItem,
} from '../lib/library';

/**
 * The creator's library.
 *
 * A thin binding over `lib/library.ts`, which owns the storage shape. The state
 * is held here rather than read on every render so a save is reflected
 * immediately, and a `storage` event is subscribed so two tabs of the same
 * browser stay in step.
 */
export interface UseLibraryResult {
  items: LibraryItem[];
  filtered: LibraryItem[];
  filters: LibraryFilters;
  setFilters(filters: LibraryFilters): void;
  save(item: LibraryItem): void;
  update(jobId: string, patch: Partial<Omit<LibraryItem, 'jobId'>>): void;
  remove(jobId: string): void;
  isSaved(jobId: string): boolean;
}

export function useLibrary(): UseLibraryResult {
  const [items, setItems] = useState<LibraryItem[]>(() => readLibrary());
  const [filters, setFilters] = useState<LibraryFilters>(DEFAULT_LIBRARY_FILTERS);

  // Another tab wrote to the library: pick it up rather than showing stale data.
  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key === LIBRARY_STORAGE_KEY) setItems(readLibrary());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const save = useCallback((item: LibraryItem) => {
    setItems(saveToLibrary(item));
  }, []);

  const update = useCallback((jobId: string, patch: Partial<Omit<LibraryItem, 'jobId'>>) => {
    setItems(updateLibraryItem(jobId, patch));
  }, []);

  const remove = useCallback((jobId: string) => {
    setItems(removeFromLibrary(jobId));
  }, []);

  const isSaved = useCallback(
    (jobId: string) => items.some((item) => item.jobId === jobId),
    [items],
  );

  return {
    items,
    filtered: filterLibrary(items, filters),
    filters,
    setFilters,
    save,
    update,
    remove,
    isSaved,
  };
}
