import { cn } from '../lib/cn';

export interface ProgressRingProps {
  /** 0-100. Values outside the range are clamped. */
  value: number;
  size?: number;
  thickness?: number;
  /** Accessible name, e.g. "DNA sync". */
  label?: string;
  /** Hides the numeric label inside the ring. */
  hideValue?: boolean;
  className?: string;
}

/**
 * Determinate circular progress used for DNA sync % and render progress.
 * Exposes `role="progressbar"` with `aria-valuenow` for screen readers.
 */
export function ProgressRing({
  value,
  size = 96,
  thickness = 8,
  label = 'Progress',
  hideValue = false,
  className,
}: ProgressRingProps) {
  const safeValue = Number.isFinite(value) ? value : 0;
  const clamped = Math.max(0, Math.min(100, safeValue));
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);

  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={cn('relative inline-flex items-center justify-center', className)}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--color-peach-100)"
          strokeWidth={thickness}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--color-peach-500)"
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-[stroke-dashoffset] duration-500 ease-out"
        />
      </svg>
      {hideValue === true ? null : (
        <span className="absolute text-title font-semibold text-ink-900">{Math.round(clamped)}%</span>
      )}
    </div>
  );
}
