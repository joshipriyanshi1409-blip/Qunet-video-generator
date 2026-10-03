import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  isTerminalStage,
  stageLabel,
  type RenderProgressEvent,
  type RenderStage,
} from '@creatordna/shared';
import { useJobStatus } from './useJobs';
import {
  fetchRenderJob,
  isTerminalState,
  retryRenderJob,
  toRenderJobView,
  type RenderJobView,
} from '../lib/render';
import { RenderSocket } from '../lib/renderSocket';
import { estimateEta, type EtaEstimate } from '../lib/eta';

/**
 * One render job, followed live.
 *
 * Two sources, one state. The WebSocket pushes stage and progress as the worker
 * reports them; the poll is the safety net that catches a job that finished while
 * the socket was reconnecting. The socket wins whenever it has spoken, because it
 * is the more recent signal - and the poll backs off to nothing once the job is
 * terminal, so a finished render costs no requests.
 */

export interface UseRenderJobResult {
  job: RenderJobView | null;
  /** True until the first read of the job document lands. */
  isLoading: boolean;
  /** The read failed (404, 503, network). */
  error: unknown;
  /** Live stage, or the last one the job reported. */
  stage: RenderStage;
  /** 0-100. */
  progress: number;
  /** Human message from the last progress event, when there was one. */
  message: string | null;
  eta: EtaEstimate;
  /** True while the socket is connected and pushing. */
  live: boolean;
  /** True when the job will not move again on its own. */
  finished: boolean;
  failed: boolean;
  retrying: boolean;
  /** Re-runs the failed stage, keeping every earlier asset. */
  retry: () => Promise<void>;
  /** Stops following this render locally. See `useRenderJob` notes on cancel. */
  cancel: () => void;
  cancelled: boolean;
  refetch: () => void;
}

export function useRenderJob(jobId: string | null): UseRenderJobResult {
  const queryClient = useQueryClient();
  const query = useJobStatus(jobId);

  const [event, setEvent] = useState<RenderProgressEvent | null>(null);
  const [live, setLive] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const startedAt = useRef<number>(Date.now());

  const job = query.data === undefined ? null : toRenderJobView(query.data);

  // The socket. One per job id, torn down when the job changes or unmounts.
  useEffect(() => {
    if (jobId === null || jobId.length === 0) return;

    const socket = new RenderSocket({
      onProgress: (next) => setEvent(next),
      onClose: ({ willReconnect }) => setLive(willReconnect === true),
      onError: () => setLive(false),
    });

    void socket.connect(jobId).then(
      () => setLive(true),
      () => setLive(false),
    );

    return () => {
      socket.dispose();
      setLive(false);
      setEvent(null);
    };
  }, [jobId]);

  // The poll. Fast while the job is moving, and off entirely once it is terminal.
  useEffect(() => {
    if (jobId === null || jobId.length === 0) return;
    const terminal = job !== null && isTerminalState(job.state);
    if (terminal === true) return;

    const timer = window.setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: ['jobs', jobId] });
    }, 5000);

    return () => window.clearInterval(timer);
  }, [jobId, job?.state, queryClient, job]);

  // Reset the clock whenever a different job is followed.
  useEffect(() => {
    startedAt.current = Date.now();
    setEvent(null);
    setCancelled(false);
  }, [jobId]);

  const stage: RenderStage = event?.stage ?? job?.stage ?? 'queued';
  const progress = event?.progress ?? job?.progress ?? 0;
  const message = event?.message ?? null;

  const eta = useMemo<EtaEstimate>(
    () => estimateEta({ progress, elapsedMs: Date.now() - startedAt.current }),
    // Recomputed on every progress change rather than on a timer: the number is
    // derived from the same samples that drive the bar, so a timer would only
    // produce frames with nothing new in them.
    [progress],
  );

  const finished = job !== null && isTerminalState(job.state);
  const failed = job?.state === 'failed' || stage === 'failed';

  const retry = useCallback(async () => {
    if (jobId === null) return;
    setRetrying(true);
    try {
      await retryRenderJob(jobId);
      setEvent(null);
      startedAt.current = Date.now();
      await queryClient.invalidateQueries({ queryKey: ['jobs', jobId] });
    } finally {
      setRetrying(false);
    }
  }, [jobId, queryClient]);

  const cancel = useCallback(() => {
    setCancelled(true);
  }, []);

  return {
    job,
    isLoading: query.isPending === true && query.data === undefined,
    error: query.error,
    stage,
    progress,
    message,
    eta,
    live,
    finished,
    failed,
    retrying,
    retry,
    cancel,
    cancelled,
    refetch: () => void queryClient.invalidateQueries({ queryKey: ['jobs', jobId ?? ''] }),
  };
}

/** Human copy for the stage the job is on, or the state it ended in. */
export function stageHeadline(stage: RenderStage, failed: boolean): string {
  if (failed === true) return 'A stage failed';
  if (stage === 'completed') return 'Your video is ready';
  if (stage === 'queued') return 'Waiting for a worker';
  return stageLabel(stage);
}

/** True when a stage can be retried on its own. */
export { isTerminalStage };

/** Reads a job once, without following it - used by the library cards. */
export function useRenderJobSnapshot(jobId: string) {
  return useJobStatus(jobId);
}

/** One-shot read used by the result page, which does not need live updates. */
export async function readRenderJob(jobId: string): Promise<RenderJobView> {
  const status = await fetchRenderJob(jobId);
  return toRenderJobView(status);
}
