import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginPage } from '../LoginPage';
import { renderWithProviders } from '../../test/utils';
import { signOutTestCreator } from '../../test/auth';

/**
 * Firebase is not configured in tests, so the page renders its dev bypass.
 * That is the same branch a developer sees locally without a project.
 */
describe('LoginPage', () => {
  beforeEach(() => {
    signOutTestCreator();
  });

  it('offers the local development bypass when Firebase is unconfigured', () => {
    renderWithProviders(<LoginPage />);

    expect(screen.getByRole('heading', { name: 'CreatorDNA Studio' })).toBeInTheDocument();
    expect(screen.getByText(/Firebase is not configured/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /local creator/i })).toBeInTheDocument();
    // No email form without a Firebase project.
    expect(screen.queryByLabelText('Email')).toBeNull();
  });

  it('signs the creator in with the dev bypass', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />);

    await user.click(screen.getByRole('button', { name: /local creator/i }));

    await waitFor(() => {
      expect(window.localStorage.getItem('creatordna.dev-uid')).toBe('local-creator');
    });
  });

  it('switches between sign in and create account', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />);

    expect(screen.getByRole('tab', { name: 'Sign in' })).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('tab', { name: 'Create account' }));
    expect(screen.getByRole('tab', { name: 'Create account' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('explains how to enable real Firebase auth', () => {
    renderWithProviders(<LoginPage />);
    expect(screen.getByText(/VITE_FIREBASE_/)).toBeInTheDocument();
  });
});

describe('auth error mapping', () => {
  it('maps known Firebase codes to actionable messages', async () => {
    const { mapAuthError } = await import('../../lib/firebase');

    expect(mapAuthError({ code: 'auth/invalid-credential' })).toMatch(/email or password/i);
    expect(mapAuthError({ code: 'auth/email-already-in-use' })).toMatch(/already exists/i);
    expect(mapAuthError({ code: 'auth/weak-password' })).toMatch(/6 characters/i);
    expect(mapAuthError({ code: 'auth/popup-blocked' })).toMatch(/pop-ups/i);
    expect(mapAuthError({ code: 'auth/unknown-thing' })).toMatch(/try again/i);
    expect(mapAuthError(new Error('boom'))).toBe('boom');
  });
});
