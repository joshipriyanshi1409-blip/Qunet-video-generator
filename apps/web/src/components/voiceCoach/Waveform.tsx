import { useRef } from 'react';
import { cn } from '../../lib/cn';

/**
 * Live microphone level, drawn as bars.
 *
 * A fixed, decaying window rather than a real oscilloscope: the point is "am I
 * being heard", and a waveform that only ever shows the last 40 ms reads as
 * noise to anyone who is not already staring at it.
 *
 * `role="img"` with a live label, because a purely decorative animation would
 * tell a screen-reader user nothing about whether the mic is live.
 */

const BAR_COUNT = 28;

export interface WaveformProps {
  /** 0..1 loudness of the newest frame. */
  level: number;
  /** False when the mic is off - the bars fall flat. */
  active: boolean;
  className?: string;
}

export function Waveform({ level, active, className }: WaveformProps) {
  // The window lives in a ref, not module scope: two waveforms on one page (or a
  // remount) must not share history, and no state update per frame is needed.
  const history = useRef<number[]>(new Array<number>(BAR_COUNT).fill(0));

  const next = active ? Math.min(1, Math.max(0, level)) : 0;
  history.current.push(next);
  history.current.shift();

  return (
    <div
      role="img"
      aria-label={active ? 'Microphone is live' : 'Microphone is off'}
      className={cn('flex h-12 items-center justify-center gap-1', className)}
    >
      {history.current.map((value, index) => {
        const centre = 1 - Math.abs(index - (BAR_COUNT - 1) / 2) / ((BAR_COUNT - 1) / 2);
        const height = active ? Math.max(6, value * 100 * (0.45 + 0.55 * centre)) : 6;
        return (
          <span
            key={index}
            className={cn(
              'w-1.5 rounded-pill transition-[height] duration-100',
              value > 0.66 ? 'bg-peach-500' : value > 0.33 ? 'bg-peach-400' : 'bg-peach-200',
            )}
            style={{ height: `${height}%` }}
          />
        );
      })}
    </div>
  );
}
