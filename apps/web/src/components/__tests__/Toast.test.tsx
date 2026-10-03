import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastViewport } from '../Toast';
import { toast, useToastStore } from '../../store/useToastStore';

/**
 * Toasts live in a module-level store, so every test starts from an empty one.
 * The fake-timer test runs last: leaving fake timers installed breaks the real
 * `setTimeout` that Motion's exit animations rely on in the other tests.
 */
describe('ToastViewport', () => {
  beforeEach(() => {
    useToastStore.getState().clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('announces toasts in a polite live region', () => {
    render(<ToastViewport />);

    const region = screen.getByRole('log');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveAttribute('aria-label', 'Notifications');
  });

  it('shows a pushed toast with its description', () => {
    render(<ToastViewport />);

    act(() => {
      toast({ title: 'Idea saved', description: 'Script next.', tone: 'success', duration: 0 });
    });

    expect(screen.getByText('Idea saved')).toBeInTheDocument();
    expect(screen.getByText('Script next.')).toBeInTheDocument();
  });

  it('dismisses a toast from its button', async () => {
    const user = userEvent.setup();
    render(<ToastViewport />);

    act(() => {
      toast({ title: 'Render failed', tone: 'danger', duration: 0 });
    });

    await user.click(screen.getByRole('button', { name: 'Dismiss: Render failed' }));

    expect(useToastStore.getState().toasts).toHaveLength(0);
    await waitFor(() => {
      expect(screen.getByRole('log').textContent ?? '').not.toContain('Render failed');
    });
  });

  it('keeps a toast with duration 0 until dismissed', () => {
    render(<ToastViewport />);

    act(() => {
      toast({ title: 'Sticky', duration: 0 });
    });

    expect(screen.getByText('Sticky')).toBeInTheDocument();
  });

  it('clears every toast', async () => {
    render(<ToastViewport />);

    act(() => {
      toast({ title: 'One', duration: 0 });
      toast({ title: 'Two', duration: 0 });
    });
    expect(screen.getByText('One')).toBeInTheDocument();
    expect(screen.getByText('Two')).toBeInTheDocument();

    act(() => {
      useToastStore.getState().clear();
    });

    // The store is the source of truth for what the live region announces.
    expect(useToastStore.getState().toasts).toHaveLength(0);

    // Let the exit animations finish, then nothing is announced anymore.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
    });
    expect(screen.getByRole('log').textContent ?? '').not.toContain('One');
    expect(screen.getByRole('log').textContent ?? '').not.toContain('Two');
  });

  it('auto-dismisses after the duration', async () => {
    vi.useFakeTimers();
    try {
      render(<ToastViewport />);

      act(() => {
        toast({ title: 'Temporary', tone: 'neutral', duration: 1000 });
      });
      expect(screen.getByText('Temporary')).toBeInTheDocument();

      // advanceTimersByTimeAsync also flushes the requestAnimationFrame frames
      // that Motion uses for its exit animation.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });

      // The duration elapsed, so the store dropped the toast...
      expect(useToastStore.getState().toasts).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }

    // ...and its exit animation then takes it out of the live region.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
    });
    expect(screen.getByRole('log').textContent ?? '').not.toContain('Temporary');
  });
});
