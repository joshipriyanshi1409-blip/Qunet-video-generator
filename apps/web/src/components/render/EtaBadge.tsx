import { etaHint, formatEta, type EtaEstimate } from '../../lib/eta';

export interface EtaBadgeProps {
  estimate: EtaEstimate;
  className?: string;
}

/**
 * Time left, or an honest "not yet".
 *
 * The estimate is measured rather than predicted, so before there is enough
 * signal it says "Estimating…" and explains why in the hint. Showing a confident
 * wrong number is the failure mode this component exists to avoid.
 */
export function EtaBadge({ estimate, className }: EtaBadgeProps) {
  const hint = etaHint(estimate.reason);

  return (
    <div className={className}>
      <p className="text-body-lg font-semibold text-ink-900" data-testid="render-eta">
        {formatEta(estimate.seconds)}
      </p>
      {hint.length > 0 ? (
        <p className="mt-0.5 text-caption text-ink-500">{hint}</p>
      ) : null}
    </div>
  );
}
