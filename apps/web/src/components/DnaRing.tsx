import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { cn } from '../lib/cn';

export interface DnaRingProps {
  /** 0-100 - the DNA sync score. */
  value: number;
  size?: number;
  thickness?: number;
  /** Accessible name, e.g. "DNA sync score". */
  label?: string;
  className?: string;
}

/**
 * The DNA sync ring.
 *
 * `ProgressRing` is the plain determinate ring; this one is the *animated* one
 * used on the DNA screen, where the number is the whole point of the page. It
 * counts up from zero on mount so a creator opening their profile watches the
 * score arrive rather than seeing a number pop in, and it eases rather than
 * snapping so a change reads as movement.
 *
 * With `prefers-reduced-motion` it jumps straight to the value - the number is
 * the information, and an animation that hides it is worse than none.
 */
export function DnaRing({ value, size = 160, thickness = 12, label = 'DNA sync score', className }: DnaRingProps) {
  const reduceMotion = useReducedMotion();
  const [displayed, setDisplayed] = useState(reduceMotion === true ? value : 0);

  useEffect(() => {
    if (reduceMotion === true) {
      setDisplayed(value);
      return;
    }

    let frame = 0;
    const start = performance.now();
    const duration = 900;
    const from = displayed;

    const tick = (now: number): void => {
      const elapsed = now - start;
      const t = Math.min(1, elapsed / duration);
      // easeOutCubic: fast at first, settling gently on the value.
      const eased = 1 - (1 - t) ** 3;
      setDisplayed(from + (value - from) * eased);
      if (t < 1) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // `displayed` is intentionally not a dependency: re-running on every frame
    // would restart the animation from wherever it happens to be.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, reduceMotion]);

  const safe = Number.isFinite(displayed) ? displayed : 0;
  const clamped = Math.max(0, Math.min(100, safe));
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);

  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(value)}
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
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--color-peach-500)"
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={false}
          animate={{ strokeDashoffset: offset }}
          transition={
            reduceMotion === true
              ? { duration: 0 }
              : { duration: 0.6, ease: motionTokensEase }
          }
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-display font-semibold tabular-nums text-ink-900">
          {Math.round(displayed)}%
        </span>
        <span className="text-tiny text-ink-500">in sync</span>
      </div>
    </div>
  );
}

const motionTokensEase = [0.22, 1, 0.36, 1] as const;
