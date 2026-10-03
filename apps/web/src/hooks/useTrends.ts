import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Hook, HookStyle, TrendRemixRequest } from '@creatordna/shared';
import { fetchHooks, fetchTrendsForMe, remixTrend } from '../lib/trends';

/** Query key for the ranked catalogue. */
export const trendsQueryKey = ['trends', 'for-me'] as const;

/**
 * The catalogue ranked against the creator's DNA.
 *
 * The API caches the ranking for an hour, so this is one request per session in
 * practice. `retry: false` because a 404 here means "not onboarded yet", which
 * is a state to render, not a failure to retry.
 */
export function useTrendsForMe() {
  return useQuery({
    queryKey: trendsQueryKey,
    queryFn: fetchTrendsForMe,
    retry: false,
    staleTime: 60_000,
  });
}

/** Remix one trend or idea. `trendId` doubles as the mutation key. */
export function useRemixTrend() {
  return useMutation({
    mutationFn: (input: TrendRemixRequest) => remixTrend(input),
    // A remix is a fresh generation, never a cached read: the creator pressed
    // Regenerate because they want a different answer.
    retry: false,
  });
}

/** Hook Lab: a spread of hooks, or one hook when `regenerateStyle` is set. */
export function useHooks() {
  return useMutation({
    mutationFn: (input: {
      idea: string;
      trendId?: string;
      count?: number;
      regenerateStyle?: HookStyle;
    }): Promise<Hook[]> => fetchHooks(input),
    retry: false,
  });
}

/** Drops the cached ranking so the next read re-ranks against the live DNA. */
export function useInvalidateTrends() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: trendsQueryKey });
}
