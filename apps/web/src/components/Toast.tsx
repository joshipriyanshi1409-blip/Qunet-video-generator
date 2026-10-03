import { AnimatePresence, motion } from 'motion/react';
import { useEffect } from 'react';
import {
  DEFAULT_TOAST_DURATION,
  useToastStore,
  type ToastTone,
} from '../store/useToastStore';
import { cn } from '../lib/cn';
import { motionTokens } from '../theme/tokens';

const toneClasses: Record<ToastTone, string> = {
  neutral: 'border-line bg-surface text-ink-900',
  success: 'border-success-soft bg-success-soft text-success-strong',
  warning: 'border-warning-soft bg-warning-soft text-warning-strong',
  danger: 'border-danger-soft bg-danger-soft text-danger-strong',
};

/**
 * Toast viewport. Mounted once in the app shell.
 * `role="log"` + `aria-live="polite"` announces new toasts without stealing focus.
 */
export function ToastViewport() {
  const toasts = useToastStore((state) => state.toasts);
  const dismiss = useToastStore((state) => state.dismiss);

  useEffect(() => {
    const timers = toasts.map((toast) =>
      (toast.duration ?? DEFAULT_TOAST_DURATION) > 0
        ? setTimeout(() => dismiss(toast.id), toast.duration ?? DEFAULT_TOAST_DURATION)
        : undefined,
    );
    return () => {
      for (const timer of timers) {
        if (timer !== undefined) clearTimeout(timer);
      }
    };
  }, [toasts, dismiss]);

  return (
    <div
      role="log"
      aria-live="polite"
      aria-label="Notifications"
      className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-full max-w-sm flex-col gap-2"
    >
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            layout
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: motionTokens.base, ease: motionTokens.ease }}
            className={cn(
              'pointer-events-auto flex items-start gap-3 rounded-lg border px-4 py-3 shadow-popover',
              toneClasses[toast.tone ?? 'neutral'],
            )}
          >
            <div className="min-w-0 flex-1">
              <p className="text-body font-semibold">{toast.title}</p>
              {toast.description === undefined ? null : (
                <p className="mt-0.5 text-caption opacity-90">{toast.description}</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              aria-label={`Dismiss: ${toast.title}`}
              className="rounded-pill p-1 opacity-70 hover:bg-black/5 hover:opacity-100"
            >
              <svg className="size-4" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
