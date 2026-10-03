import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface PageHeaderProps {
  title: string;
  description?: string;
  /** Buttons or filters rendered on the right. */
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <header className={cn('mb-6 flex flex-wrap items-end justify-between gap-4', className)}>
      <div className="min-w-0">
        <h1 className="text-display font-semibold tracking-tight text-ink-900">{title}</h1>
        {description === undefined ? null : (
          <p className="mt-1 max-w-2xl text-body text-ink-500">{description}</p>
        )}
      </div>
      {actions === undefined ? null : <div className="flex flex-wrap items-center gap-3">{actions}</div>}
    </header>
  );
}
