import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button';
import { cn } from '../lib/cn';
import { motionTokens } from '../theme/tokens';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  /** Buttons rendered in the footer. */
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

const sizeClasses = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
} as const;

/**
 * Accessible modal dialog: portalled, `aria-modal`, Escape to close, Tab focus
 * trap, focus restored to the trigger on close.
 */
export function Modal({ open, onClose, title, description, children, footer, size = 'md' }: ModalProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;

    const focusable = (): HTMLElement[] => {
      if (panel === null) return [];
      return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    };

    const items = focusable();
    if (items.length > 0) {
      items[0]?.focus();
    } else {
      panel?.focus();
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const tabbable = focusable();
      if (tabbable.length === 0) {
        event.preventDefault();
        panel?.focus();
        return;
      }
      const first = tabbable[0];
      const last = tabbable[tabbable.length - 1];
      if (first === undefined || last === undefined) return;

      if (event.shiftKey === true && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (event.shiftKey === false && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [open, onClose]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open === true ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            data-testid="modal-backdrop"
            className="absolute inset-0 bg-ink-900/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: motionTokens.fast }}
            onClick={onClose}
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={description === undefined ? undefined : descriptionId}
            tabIndex={-1}
            className={cn(
              'relative z-10 w-full rounded-card border border-line bg-surface p-6 shadow-popover',
              sizeClasses[size],
            )}
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: motionTokens.base, ease: motionTokens.ease }}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id={titleId} className="text-title font-semibold text-ink-900">
                  {title}
                </h2>
                {description === undefined ? null : (
                  <p id={descriptionId} className="mt-1 text-caption text-ink-500">
                    {description}
                  </p>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                iconOnly
                onClick={onClose}
                aria-label="Close dialog"
                className="text-ink-500"
              >
                <svg className="size-4" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </Button>
            </div>

            {children === undefined ? null : <div className="mt-4 text-body text-ink-700">{children}</div>}

            {footer === undefined ? null : (
              <div className="mt-6 flex flex-wrap justify-end gap-3">{footer}</div>
            )}
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
