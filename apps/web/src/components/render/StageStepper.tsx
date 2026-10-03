import { cn } from '../../lib/cn';
import { RENDER_UI_STAGES, stepFraction, stepState } from '../../lib/renderStages';

export interface StageStepperProps {
  /** Index into `RENDER_UI_STAGES` of the step the job is on, or -1. */
  currentIndex: number;
  /** Overall job percentage, used to fill the current step's own bar. */
  progress: number;
  failed: boolean;
  className?: string;
}

/**
 * The seven-step render stepper.
 *
 * A list, not a set of divs: the order is the information, and a screen reader
 * should be able to walk it. Each step announces its own state through its
 * accessible name rather than only through colour, and the current step is marked
 * `aria-current="step"` so the position survives a colour-blind reading.
 */
export function StageStepper({ currentIndex, progress, failed, className }: StageStepperProps) {
  return (
    <ol className={cn('space-y-2', className)}>
      {RENDER_UI_STAGES.map((stage, index) => {
        const state = stepState(index, { currentIndex, failed });
        const fraction = stepFraction(progress, index);
        const isCurrent = state === 'current';

        return (
          <li key={stage.id}>
            <div
              aria-current={isCurrent === true ? 'step' : undefined}
              data-step={stage.id}
              data-state={state}
              className={cn(
                'flex items-center gap-3 rounded-card border px-4 py-3 transition-colors duration-200',
                state === 'current' && 'border-peach-300 bg-peach-50',
                state === 'done' && 'border-line bg-surface',
                state === 'pending' && 'border-line bg-surface-muted',
                state === 'failed' && 'border-danger-soft bg-danger-soft',
              )}
            >
              <StepMarker state={state} index={index} />

              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    'text-body font-medium',
                    state === 'pending' ? 'text-ink-500' : 'text-ink-900',
                  )}
                >
                  {stage.label}
                </p>
                {isCurrent === true ? (
                  <div className="mt-2 h-1.5 overflow-hidden rounded-pill bg-peach-100">
                    <div
                      className="h-full rounded-pill bg-peach-500 transition-transform duration-500 ease-out"
                      style={{ width: `${Math.round(fraction * 100)}%` }}
                    />
                  </div>
                ) : null}
              </div>

              <StepStateLabel state={state} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function StepMarker({ state, index }: { state: ReturnType<typeof stepState>; index: number }) {
  const base =
    'flex size-8 shrink-0 items-center justify-center rounded-pill text-caption font-semibold';

  if (state === 'done') {
    return (
      <span aria-hidden="true" className={cn(base, 'bg-success-soft text-success-strong')}>
        <svg className="size-4" viewBox="0 0 24 24" fill="none">
          <path d="M4 12.5 9 17.5 20 6.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }

  if (state === 'failed') {
    return (
      <span aria-hidden="true" className={cn(base, 'bg-danger text-white')}>
        <svg className="size-4" viewBox="0 0 24 24" fill="none">
          <path d="M12 7v7M12 17h.01" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        base,
        state === 'current' ? 'bg-peach-500 text-white' : 'bg-ink-100 text-ink-500',
      )}
    >
      {index + 1}
    </span>
  );
}

function StepStateLabel({ state }: { state: ReturnType<typeof stepState> }) {
  const labels: Record<ReturnType<typeof stepState>, string> = {
    done: 'Done',
    current: 'Running',
    pending: 'Waiting',
    failed: 'Failed',
  };

  return (
    <span className="shrink-0 text-tiny font-medium uppercase tracking-wide text-ink-500">
      {labels[state]}
    </span>
  );
}
