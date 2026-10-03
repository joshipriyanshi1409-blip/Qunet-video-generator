import { create } from 'zustand';

export type ToastTone = 'neutral' | 'success' | 'warning' | 'danger';

export interface Toast {
  id: string;
  title: string;
  description?: string;
  /** Defaults to `neutral`. */
  tone?: ToastTone;
  /** Milliseconds before auto-dismiss; 0 keeps it until dismissed. Defaults to 6s. */
  duration?: number;
}

/** Default auto-dismiss, in milliseconds. */
export const DEFAULT_TOAST_DURATION = 6000;

interface ToastState {
  toasts: Toast[];
  push(toast: Omit<Toast, 'id'>): string;
  dismiss(id: string): void;
  clear(): void;
}

/** Normalises a toast so `duration` is always a number by the time it renders. */
function withDefaults(toast: Omit<Toast, 'id'>): Omit<Toast, 'id'> {
  return {
    ...toast,
    tone: toast.tone ?? 'neutral',
    duration: toast.duration ?? DEFAULT_TOAST_DURATION,
  };
}

let counter = 0;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],

  push(toast) {
    counter += 1;
    const id = `toast-${counter}`;
    set((state) => ({
      toasts: [...state.toasts, { ...withDefaults(toast), id }],
    }));
    return id;
  },

  dismiss(id) {
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
  },

  clear() {
    set({ toasts: [] });
  },
}));

/** Imperative helper for non-React code (e.g. a failed mutation). */
export function toast(options: Omit<Toast, 'id'>): string {
  return useToastStore.getState().push(options);
}
