import { useEffect, useRef } from 'react';
import type { LiveSessionScript } from '@creatordna/shared';
import { cn } from '../../lib/cn';

/**
 * The script, one line at a time, with the current line highlighted.
 *
 * The creator reads aloud, so the line they are on has to be findable without
 * looking away from the camera: it is larger, darker and scrolled into view. The
 * list is a real `<ol>` with `aria-current`, so a screen reader announces the
 * position instead of just re-reading the whole script.
 */

export interface ScriptTeleprompterProps {
  script: LiveSessionScript;
  /** Index of the line being read. */
  currentLine: number;
  onSelectLine?(index: number): void;
  className?: string;
}

export function ScriptTeleprompter({
  script,
  currentLine,
  onSelectLine,
  className,
}: ScriptTeleprompterProps) {
  const activeRef = useRef<HTMLLIElement>(null);

  // Keep the current line in view. A long script scrolls; the creator should
  // never have to find their place again mid-take.
  useEffect(() => {
    const element = activeRef.current;
    // Guarded because `scrollIntoView` is missing from jsdom and from a few
    // embedded webviews, and a missing scroll must not break the teleprompter.
    if (element !== null && typeof element.scrollIntoView === 'function') {
      element.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [currentLine]);

  const safeIndex = Math.min(Math.max(0, currentLine), script.length - 1);

  return (
    <ol className={cn('space-y-1', className)}>
      {script.map((line, index) => {
        const isCurrent = index === safeIndex;
        const isPast = index < safeIndex;

        return (
          <li
            key={index}
            ref={isCurrent ? activeRef : undefined}
            aria-current={isCurrent ? 'step' : undefined}
            className={cn(
              'rounded-card px-3 py-2 text-body transition-colors duration-150',
              isPast && 'text-ink-400 line-through decoration-peach-200',
              isCurrent && 'bg-peach-50 text-body-lg font-semibold text-ink-900',
              !isCurrent && !isPast && 'text-ink-600',
            )}
          >
            {onSelectLine === undefined ? (
              line
            ) : (
              <button
                type="button"
                onClick={() => onSelectLine(index)}
                className="w-full text-left"
                aria-label={`Read line ${index + 1}: ${line}`}
              >
                {line}
              </button>
            )}
          </li>
        );
      })}
    </ol>
  );
}
