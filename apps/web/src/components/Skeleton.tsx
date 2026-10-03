import type { HTMLAttributes } from 'react';
import { cn } from '../lib/cn';

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  /** Rendered as a circle when true. */
  circle?: boolean;
}

export function Skeleton({ className, circle = false, ...rest }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse bg-peach-100', circle === true ? 'rounded-pill' : 'rounded-md', className)}
      {...rest}
    />
  );
}

export interface SkeletonTextProps extends HTMLAttributes<HTMLDivElement> {
  lines?: number;
  /** Width of the last line, as a fraction of the container. */
  lastLineWidth?: number;
}

export function SkeletonText({ lines = 3, lastLineWidth = 0.6, className, ...rest }: SkeletonTextProps) {
  return (
    <div className={cn('space-y-2', className)} {...rest}>
      {Array.from({ length: lines }, (_unused, index) => (
        <Skeleton
          key={index}
          className="h-3.5"
          // The last line is shorter so it reads like a paragraph.
          style={index === lines - 1 ? { width: `${lastLineWidth * 100}%` } : undefined}
        />
      ))}
    </div>
  );
}

export function SkeletonCard({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-card border border-line bg-surface p-5 shadow-card', className)}
      {...rest}
    >
      <Skeleton className="h-4 w-1/3" />
      <SkeletonText lines={3} className="mt-4" />
    </div>
  );
}
