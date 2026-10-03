import { useId, useState, type ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface DisclosureProps {
  /** Visible heading of the collapsible section. */
  title: string;
  /** Small label shown next to the title, e.g. "3 beats". */
  meta?: ReactNode;
  /** Rendered open by default. */
  defaultOpen?: boolean;
  /** Actions rendered in the heading row (copy, regenerate). */
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}

/**
 * An expandable section used by the remix screen for Hook / Script / CTA.
 *
 * The button owns `aria-expanded` and `aria-controls`, and the panel is only
 * mounted when open, so a collapsed section is invisible to assistive tech and
 * to tab order - it is genuinely hidden, not visually hidden.
 */
export function Disclosure({
  title,
  meta,
  defaultOpen = false,
  actions,
  className,
  children,
}: DisclosureProps) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();

  return (
    <section className={cn('rounded-card border border-line bg-surface', className)}>
      <div className="flex items-center gap-3 px-5 py-3">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls={panelId}
          className="flex flex-1 items-center gap-2 rounded-md text-left text-body font-semibold text-ink-900 focus-visible:outline-none"
        >
          <ChevronIcon open={open} />
          <span>{title}</span>
          {meta === undefined ? null : <span className="text-caption font-normal text-ink-500">{meta}</span>}
        </button>
        {actions === undefined ? null : <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {open === true ? (
        <div id={panelId} className="border-t border-line px-5 py-4">
          {children}
        </div>
      ) : null}
    </section>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={cn('size-4 shrink-0 text-ink-500 transition-transform duration-150', open === true && 'rotate-90')}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
