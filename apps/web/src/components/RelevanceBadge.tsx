import { Badge, type BadgeTone } from './Badge';

export interface RelevanceBadgeProps {
  /** 0-100 relevance against the creator's DNA. */
  value: number;
  className?: string;
}

/**
 * Relevance as a percentage plus a spoken label.
 *
 * The visible number is the fast read; `aria-label` is what a screen reader
 * says, because "55" alone tells a blind creator nothing about what it means.
 */
export function RelevanceBadge({ value, className }: RelevanceBadgeProps) {
  return (
    <Badge tone={relevanceTone(value)} className={className} aria-label={`Relevance to your DNA: ${value}%`}>
      {value}% match
    </Badge>
  );
}

/** Higher is better, and the colour follows the score. */
function relevanceTone(value: number): BadgeTone {
  if (value >= 70) return 'success';
  if (value >= 45) return 'peach';
  return 'neutral';
}
