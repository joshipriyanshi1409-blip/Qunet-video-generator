import { COACH_TIP_LABELS, type CoachTip, type CoachTipSeverity } from '@creatordna/shared';
import { cn } from '../../lib/cn';

/**
 * The live coaching feed: pace, clarity, filler words, energy and tone match.
 *
 * Newest first, because a tip that arrives while you are talking has to be the
 * one you can still act on. Each row is a live region so a screen reader hears
 * the tip as it lands rather than making the creator hunt for it.
 */

export interface FeedbackFeedProps {
  tips: CoachTip[];
  /** Latest interim transcript or status line from the model. */
  transcript: string;
  className?: string;
}

const severityStyles: Record<CoachTipSeverity, { badge: string; dot: string; label: string }> = {
  good: { badge: 'bg-success-soft text-success-strong', dot: 'bg-success', label: 'Working' },
  info: { badge: 'bg-info-soft text-info-strong', dot: 'bg-info', label: 'Note' },
  warning: { badge: 'bg-warning-soft text-warning-strong', dot: 'bg-warning', label: 'Fix' },
};

export function FeedbackFeed({ tips, transcript, className }: FeedbackFeedProps) {
  const newestFirst = [...tips].reverse();

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {transcript.length > 0 ? (
        <p
          aria-live="polite"
          className="rounded-card bg-ink-50 px-3 py-2 text-caption italic text-ink-600"
        >
          {transcript}
        </p>
      ) : null}

      {newestFirst.length === 0 ? (
        <p className="px-1 text-caption text-ink-500">
          No tips yet. Start reading and the coach will speak up.
        </p>
      ) : (
        <ul aria-live="polite" aria-label="Live coaching tips" className="flex flex-col gap-2">
          {newestFirst.map((tip, index) => {
            const style = severityStyles[tip.severity];
            return (
              <li
                key={`${tip.atSeconds ?? 0}-${index}`}
                className="flex items-start gap-3 rounded-card border border-line bg-surface p-3"
              >
                <span
                  aria-hidden="true"
                  className={cn('mt-1.5 size-2 shrink-0 rounded-pill', style.dot)}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-caption font-semibold text-ink-900">
                      {COACH_TIP_LABELS[tip.kind]}
                    </span>
                    <span
                      className={cn(
                        'rounded-pill px-2 py-0.5 text-tiny font-medium uppercase tracking-wide',
                        style.badge,
                      )}
                    >
                      {style.label}
                    </span>
                    {tip.atSeconds === undefined ? null : (
                      <span className="text-tiny text-ink-400">
                        at {Math.round(tip.atSeconds)}s
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-body text-ink-700">{tip.message}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
