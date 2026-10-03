import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode;
  /** Selected state - used for tone words, audience segments, hashtags. */
  selected?: boolean;
  onRemove?: () => void;
  /** Accessible name for the remove button (defaults to "Remove"). */
  removeLabel?: string;
}

export function Chip({
  children,
  selected = false,
  onRemove,
  removeLabel = 'Remove',
  className,
  ...rest
}: ChipProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-pill border px-3 py-1 text-caption',
        selected === true
          ? 'border-peach-300 bg-peach-100 text-peach-800'
          : 'border-line bg-surface-muted text-ink-700',
        className,
      )}
      {...rest}
    >
      {children}
      {onRemove === undefined ? null : (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`${removeLabel} ${typeof children === 'string' ? children : ''}`.trim()}
          className="-mr-1 rounded-pill p-0.5 text-ink-500 hover:bg-peach-200 hover:text-peach-800"
        >
          <svg className="size-3.5" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path
              d="M5 5l10 10M15 5L5 15"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      )}
    </span>
  );
}
