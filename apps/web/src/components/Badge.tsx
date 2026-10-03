import type { HTMLAttributes } from 'react';
import type { ReactionLevel } from '@creatordna/shared';
import { cn } from '../lib/cn';
import { reactionTone } from '../theme/tokens';

export type BadgeTone = 'neutral' | 'peach' | 'success' | 'warning' | 'danger' | 'info';

const toneClasses: Record<BadgeTone, string> = {
  neutral: 'bg-ink-100 text-ink-700',
  peach: 'bg-peach-100 text-peach-800',
  success: 'bg-success-soft text-success-strong',
  warning: 'bg-warning-soft text-warning-strong',
  danger: 'bg-danger-soft text-danger-strong',
  info: 'bg-info-soft text-info-strong',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  /** Small uppercase label - used for stage names and counts. */
  compact?: boolean;
}

export function Badge({ tone = 'neutral', compact = false, className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-pill px-2.5 py-0.5 font-medium',
        compact === true ? 'text-tiny uppercase tracking-wide' : 'text-caption',
        toneClasses[tone],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}

const reactionLabels: Record<ReactionLevel, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

/**
 * High / Medium / Low prediction badge used by Hook Lab and Audience Mirror.
 * The accessible name always spells out that this is an AI prediction.
 */
export function ReactionBadge({ level, className }: { level: ReactionLevel; className?: string }) {
  const tone = reactionTone[level] as BadgeTone;
  return (
    <Badge
      tone={tone}
      className={className}
      aria-label={`Predicted reaction: ${reactionLabels[level]}`}
      data-reaction={level}
    >
      {reactionLabels[level]}
    </Badge>
  );
}
