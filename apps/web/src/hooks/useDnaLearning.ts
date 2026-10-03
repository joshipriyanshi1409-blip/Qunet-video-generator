import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DnaSuggestion, DnaSuggestionStatus } from '@creatordna/shared';
import {
  acceptSuggestion,
  fetchSuggestions,
  fetchVersions,
  generateSuggestions,
  rejectSuggestion,
} from '../lib/dnaLearning';
import { dnaQueryKey } from './useDna';

/** Query keys, kept together so invalidation never guesses a string. */
export const suggestionsQueryKey = (status?: DnaSuggestionStatus) =>
  ['dna', 'suggestions', status ?? 'all'] as const;
export const versionsQueryKey = ['dna', 'versions'] as const;

/**
 * Pending proposals.
 *
 * Only `pending` is fetched by default: the accept/reject history is a separate
 * concern, and mixing the two would make the panel re-render every time an old
 * proposal is resolved.
 */
export function useDnaSuggestions(status: DnaSuggestionStatus = 'pending') {
  return useQuery({
    queryKey: suggestionsQueryKey(status),
    queryFn: () => fetchSuggestions(status),
    retry: false,
    staleTime: 15_000,
  });
}

/** Asks the model to reason over signals it has not seen yet. */
export function useGenerateSuggestions() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: generateSuggestions,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: suggestionsQueryKey('pending') });
      void queryClient.invalidateQueries({ queryKey: ['dna', 'signals'] });
    },
  });
}

/**
 * Accepts a proposal.
 *
 * The DNA query is refreshed rather than merely invalidated: the response *is*
 * the new profile, so writing it straight into the cache means the ring and the
 * injected-context block move in the same frame as the confirmation.
 */
export function useAcceptSuggestion() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => acceptSuggestion(id),
    onSuccess: (profile) => {
      queryClient.setQueryData(dnaQueryKey, profile);
      void queryClient.invalidateQueries({ queryKey: suggestionsQueryKey('pending') });
      void queryClient.invalidateQueries({ queryKey: versionsQueryKey });
    },
  });
}

/** Rejects a proposal. Touches nothing but the proposal itself. */
export function useRejectSuggestion() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => rejectSuggestion(id),
    onSuccess: (updated: DnaSuggestion) => {
      void queryClient.invalidateQueries({ queryKey: suggestionsQueryKey('pending') });
      void queryClient.invalidateQueries({ queryKey: suggestionsQueryKey(updated.status) });
    },
  });
}

/** The version history, with the live version marked. */
export function useDnaVersions(limit?: number) {
  return useQuery({
    queryKey: versionsQueryKey,
    queryFn: () => fetchVersions(limit),
    retry: false,
    staleTime: 30_000,
  });
}
