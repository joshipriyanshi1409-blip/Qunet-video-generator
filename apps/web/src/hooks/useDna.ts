import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DnaOnboardingInput, DnaUpdateRequest } from '@creatordna/shared';
import { extractDna, fetchDna, updateDna } from '../lib/dna';

/** Query key for the signed-in creator's DNA profile. */
export const dnaQueryKey = ['dna'] as const;

/** Loads the stored DNA profile. `404` means "not onboarded yet", not an error. */
export function useDnaProfile() {
  return useQuery({
    queryKey: dnaQueryKey,
    queryFn: fetchDna,
    retry: false,
    staleTime: 30_000,
  });
}

/** Runs the extraction prompt and stores the result. */
export function useExtractDna() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: DnaOnboardingInput) => extractDna(input),
    onSuccess: (data) => {
      queryClient.setQueryData(dnaQueryKey, data);
    },
  });
}

/** Saves a partial edit from the "Edit DNA" modal. */
export function useUpdateDna() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (patch: DnaUpdateRequest) => updateDna(patch),
    onSuccess: (data) => {
      queryClient.setQueryData(dnaQueryKey, data);
    },
  });
}

/** True when the creator has a stored profile. */
export function useHasDna(): boolean {
  const query = useDnaProfile();
  return query.data !== undefined;
}
