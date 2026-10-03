import { useQuery } from '@tanstack/react-query';
import { jobStatusResponseSchema, type JobStatusResponse } from '@creatordna/shared';
import { request } from '../lib/api';

/** Query key for one job's live state. */
export function jobStatusQueryKey(jobId: string) {
  return ['jobs', jobId] as const;
}

/**
 * Live state of one job.
 *
 * Polls while the job is not finished: a render that is `waiting` needs the
 * screen to notice when a worker picks it up. The interval backs off to nothing
 * once the job reaches a terminal state, so a finished render costs no requests.
 */
export function useJobStatus(jobId: string | null) {
  return useQuery({
    queryKey: jobStatusQueryKey(jobId ?? ''),
    queryFn: () => request(`/api/v1/jobs/${jobId ?? ''}`, jobStatusResponseSchema),
    enabled: jobId !== null && jobId.length > 0,
    retry: false,
    refetchInterval: (query) => {
      const status: JobStatusResponse | undefined = query.state.data;
      if (status === undefined) return 2000;
      const terminal = status.state === 'completed' || status.state === 'failed';
      return terminal ? false : 2000;
    },
  });
}
