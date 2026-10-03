import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '../lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-peach-500 text-white hover:bg-peach-600 active:bg-peach-700',
  secondary: 'border border-line bg-surface text-ink-900 hover:bg-peach-50',
  ghost: 'bg-transparent text-ink-700 hover:bg-peach-100',
  danger: 'bg-danger text-white hover:bg-danger-strong',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-8 gap-1.5 px-3 text-caption',
  md: 'h-10 gap-2 px-4 text-body',
  lg: 'h-12 gap-2.5 px-6 text-body-lg',
};

const squareSizeClasses: Record<ButtonSize, string> = {
  sm: 'w-8 px-0',
  md: 'w-10 px-0',
  lg: 'w-12 px-0',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner and blocks interaction. */
  loading?: boolean;
  /** Square button for a single icon - still requires an accessible name. */
  iconOnly?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    iconOnly = false,
    className,
    children,
    disabled,
    type = 'button',
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled === true || loading}
      aria-busy={loading === true ? true : undefined}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-pill font-medium',
        // The press scale is a micro-interaction, not decoration: it confirms
        // the click landed on a touch target before the request has answered.
        'transition-[color,background-color,transform] duration-150 active:scale-[0.98]',
        'disabled:cursor-not-allowed disabled:active:scale-100 disabled:opacity-60',
        variantClasses[variant],
        sizeClasses[size],
        iconOnly === true && squareSizeClasses[size],
        className,
      )}
      {...rest}
    >
      {loading === true ? <Spinner /> : null}
      {children}
    </button>
  );
});

function Spinner() {
  return (
    <svg
      className="size-4 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      data-testid="button-spinner"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
