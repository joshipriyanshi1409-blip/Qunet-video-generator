import { LIVE_MAX_SESSION_SECONDS } from '@creatordna/shared';
import { formatDuration } from '../../audio/pcm';
import { cn } from '../../lib/cn';

/**
 * Session timer with the per-session budget as a progress bar.
 *
 * The remaining time is the number that matters, so it is the large one; the bar
 * is the same value at a glance. The last 30 seconds turn amber, because "you
 * have ten seconds" is not something a creator should discover.
 */

export interface SessionTimerProps {
  elapsedSeconds: number;
  remainingSeconds: number;
  /** Pauses the warning colour, e.g. while recording a fallback take. */
  warnAtSeconds?: number;
  className?: string;
}

export function SessionTimer({
  elapsedSeconds,
  remainingSeconds,
  warnAtSeconds = 30,
  className,
}: SessionTimerProps) {
  const used = Math.min(elapsedSeconds, LIVE_MAX_SESSION_SECONDS);
  const progress = Math.round((used / LIVE_MAX_SESSION_SECONDS) * 100);
  const urgent = remainingSeconds <= warnAtSeconds;

  return (
    <div className={cn('flex items-center gap-3', className)}>
      <div
        role="timer"
        aria-live="off"
        aria-label={`${Math.round(remainingSeconds)} seconds left in this session`}
        className={cn(
          'font-mono text-body-lg tabular-nums',
          urgent ? 'text-warning-strong' : 'text-ink-900',
        )}
      >
        {formatDuration(remainingSeconds)}
      </div>

      <div
        role="progressbar"
        aria-valuenow={progress}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Session time used"
        className="h-1.5 w-24 overflow-hidden rounded-pill bg-peach-100"
      >
        <div
          className={cn('h-full rounded-pill', urgent ? 'bg-warning' : 'bg-peach-500')}
          style={{ width: `${progress}%` }}
        />
      </div>

      <span className="text-tiny text-ink-400">
        {formatDuration(elapsedSeconds)} of {formatDuration(LIVE_MAX_SESSION_SECONDS)}
      </span>
    </div>
  );
}
