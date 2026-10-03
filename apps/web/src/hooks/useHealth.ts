import { useQuery } from '@tanstack/react-query';
import { fetchHealth } from '../lib/api';

/** Live API status, polled while the app is open. */
export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: ({ signal }) => fetchHealth(signal),
    refetchInterval: 30_000,
    staleTime: 10_000,
    retry: 1,
  });
}
