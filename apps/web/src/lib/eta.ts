/**
 * ETA for a render.
 *
 * The pipeline knows how much of the *job* is done (weighted stage progress) but
 * not how long any stage takes - a clip generation is seconds on a good day and
 * minutes on a bad one. So the estimate is measured, not predicted: it uses the
 * rate the job has actually been running at, and refuses to answer until there
 * is enough signal for the number to mean anything.
 *
 * Refusing to guess is the point. A confident wrong ETA is worse than none.
 */

/** Below this much observed progress, there is no rate worth reporting. */
export const ETA_MIN_PROGRESS_PERCENT = 2;

/** Below this much elapsed time, the rate is noise. */
export const ETA_MIN_ELAPSED_MS = 3000;

export interface EtaSample {
  /** Job percentage, 0-100. */
  progress: number;
  /** Milliseconds since the job was accepted. */
  elapsedMs: number;
}

export interface EtaEstimate {
  /** Seconds left, or null when there is not enough signal yet. */
  seconds: number | null;
  /** Why there is no estimate, when `seconds` is null. */
  reason: 'warming-up' | 'stalled' | 'done';
}

/**
 * Estimates the seconds left, or explains why it cannot.
 *
 * `stalled` is deliberately distinct from `warming-up`: a job that has been
 * running for a while without moving is not "still learning", and the UI should
 * say so rather than show a number that keeps growing.
 */
export function estimateEta(sample: EtaSample): EtaEstimate {
  if (sample.progress >= 100) return { seconds: 0, reason: 'done' };
  // Non-finite input means there is no signal at all, which is not the same as a
  // job that has stopped - so it reads as "still warming up", not "stalled".
  if (Number.isFinite(sample.progress) === false || Number.isFinite(sample.elapsedMs) === false) {
    return { seconds: null, reason: 'warming-up' };
  }
  // A negative percentage is a bad report, not a slow job.
  if (sample.progress < 0) return { seconds: null, reason: 'stalled' };
  if (sample.progress < ETA_MIN_PROGRESS_PERCENT) return { seconds: null, reason: 'warming-up' };
  if (sample.elapsedMs < ETA_MIN_ELAPSED_MS) return { seconds: null, reason: 'warming-up' };

  const percentPerMs = sample.progress / sample.elapsedMs;
  if (percentPerMs <= 0) return { seconds: null, reason: 'stalled' };

  const remainingMs = (100 - sample.progress) / percentPerMs;
  if (!Number.isFinite(remainingMs) || remainingMs < 0) return { seconds: null, reason: 'stalled' };

  return { seconds: Math.round(remainingMs / 1000), reason: 'done' };
}

/**
 * Formats an ETA for a human.
 *
 * Rounds up so "about 1 min left" is never shown for 61 seconds of work, and
 * switches to minutes past a minute rather than reading "95s".
 */
export function formatEta(seconds: number | null): string {
  if (seconds === null) return 'Estimating…';
  if (seconds <= 0) return 'Any moment now';
  if (seconds < 60) return `about ${seconds}s left`;

  const minutes = Math.ceil(seconds / 60);
  return `about ${minutes} min left`;
}

/** Short label for the "why no ETA" case. */
export function etaHint(reason: EtaEstimate['reason']): string {
  switch (reason) {
    case 'warming-up':
      return 'We will estimate the time left once the first stage reports in.';
    case 'stalled':
      return 'No progress for a while - this can happen while a clip renders.';
    case 'done':
      return '';
  }
}
