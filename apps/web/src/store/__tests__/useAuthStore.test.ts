import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEV_USER_UID,
  resetAuthStoreSubscription,
  useAuthStore,
  type AuthState,
} from '../useAuthStore';

const DEV_KEY = 'creatordna.dev-uid';

function state(): AuthState {
  return useAuthStore.getState();
}

describe('useAuthStore', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useAuthStore.setState({
      status: 'signed-out',
      user: null,
      error: null,
      pending: false,
      firebaseReady: false,
    });
    resetAuthStoreSubscription();
  });

  afterEach(() => {
    resetAuthStoreSubscription();
    vi.restoreAllMocks();
  });

  it('starts signed out when no dev session is stored', async () => {
    await useAuthStore.getState().init();

    expect(state().status).toBe('signed-out');
    expect(state().user).toBeNull();
    expect(window.localStorage.getItem(DEV_KEY)).toBeNull();
  });

  it('restores a stored dev session on init', async () => {
    window.localStorage.setItem(DEV_KEY, 'creator-a');
    await useAuthStore.getState().init();

    expect(state().status).toBe('signed-in');
    expect(state().user).toEqual({
      uid: 'creator-a',
      email: null,
      displayName: 'Local creator',
      emailVerified: false,
      devBypass: true,
    });
  });

  it('signs in as the default dev creator and persists the uid', async () => {
    await useAuthStore.getState().signInAsDevUser();

    expect(state().status).toBe('signed-in');
    expect(state().user?.uid).toBe(DEV_USER_UID);
    expect(state().user?.devBypass).toBe(true);
    expect(window.localStorage.getItem(DEV_KEY)).toBe(DEV_USER_UID);
  });

  it('accepts an explicit dev uid and trims it', async () => {
    await useAuthStore.getState().signInAsDevUser('  creator-b  ');

    expect(state().user?.uid).toBe('creator-b');
    expect(window.localStorage.getItem(DEV_KEY)).toBe('creator-b');
  });

  it('falls back to the default uid for a blank argument', async () => {
    await useAuthStore.getState().signInAsDevUser('   ');

    expect(state().user?.uid).toBe(DEV_USER_UID);
  });

  it('signing out clears the dev session and storage', async () => {
    await useAuthStore.getState().signInAsDevUser();
    await useAuthStore.getState().signOut();

    expect(state().status).toBe('signed-out');
    expect(state().user).toBeNull();
    expect(window.localStorage.getItem(DEV_KEY)).toBeNull();
  });

  it('reports a mapped message when a Firebase sign-in fails', async () => {
    // Firebase is inert in tests, so `signInWithGoogle` rejects synchronously
    // through the not-configured guard rather than through a real popup.
    useAuthStore.setState({ firebaseReady: true });

    await useAuthStore.getState().signInWithGoogle();

    expect(state().status).toBe('signed-out');
    expect(state().pending).toBe(false);
    expect(state().error).not.toBeNull();
  });

  it('clearError resets only the error', async () => {
    useAuthStore.setState({ error: 'Something went wrong' });
    useAuthStore.getState().clearError();

    expect(state().error).toBeNull();
  });
});
