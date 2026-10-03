import { cn } from '../lib/cn';

export interface ProgressBarProps {
  /** 0-100. Values outside the range are clamped. */
  value: number;
  /** Accessible name, e.g. "Render progress". */
  label: string;
  /** Shows the percentage next to the bar. */
  showValue?: boolean;
  className?: string;
}

/**
 * Determinate linear progress.
 *
 * Exposes `role="progressbar"` with `aria-valuenow`, and the value is also
 * rendered as text so a screen-reader user hears the number rather than only
 * "progressbar". The fill is a transform, not a width change, so the animation
 * stays on the compositor.
 */
export function ProgressBar({ value, label, showValue = true, className }: ProgressBarProps) {
  const safe = Number.isFinite(value) ? value : 0;
  const clamped = Math.max(0, Math.min(100, safe));
  const rounded = Math.round(clamped);

  return (
    <div className={cn('flex items-center gap-3', className)}>
      <div
        role="progressbar"
        aria-valuenow={rounded}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
        className="h-2.5 flex-1 overflow-hidden rounded-pill bg-peach-100"
      >
        <div
          className="h-full rounded-pill bg-peach-500 transition-transform duration-500 ease-out"
          style={{ width: `${clamped}%` }}
        />
      </div>
      {showValue === true ? (
        <span className="w-11 shrink-0 text-right text-caption font-semibold tabular-nums text-ink-900">
          {rounded}%
        </span>
      ) : null}
    </div>
  );
}
