import { create } from 'zustand';
import {
  isFirebaseConfigured,
  mapAuthError,
  signInWithEmail,
  signInWithGoogle,
  signOutUser,
  signUpWithEmail,
  subscribeToAuthChanges,
  toAuthUser,
} from '../lib/firebase';

export type AuthStatus = 'loading' | 'signed-out' | 'signed-in';

export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  emailVerified: boolean;
  /** True when the session is the local dev bypass, not real Firebase auth. */
  devBypass: boolean;
}

export interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
  /** Set when the last action failed; cleared on the next attempt. */
  error: string | null;
  /** True while an auth action is in flight. */
  pending: boolean;
  /** True when Firebase is configured; false means the dev bypass is offered. */
  firebaseReady: boolean;

  /** Subscribes to Firebase and resolves once the first state is known. */
  init(): Promise<void>;
  signInWithGoogle(): Promise<void>;
  signUpWithEmail(email: string, password: string): Promise<void>;
  signInWithEmail(email: string, password: string): Promise<void>;
  /** Local development only - mirrors the API's `x-dev-uid` bypass. */
  signInAsDevUser(uid?: string): Promise<void>;
  signOut(): Promise<void>;
  clearError(): void;
}

/** Dev-only uid used when Firebase is not configured. */
export const DEV_USER_UID = 'local-creator';
const DEV_USER_STORAGE_KEY = 'creatordna.dev-uid';

function readStoredDevUid(): string | null {
  try {
    return window.localStorage.getItem(DEV_USER_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredDevUid(uid: string | null): void {
  try {
    if (uid === null) {
      window.localStorage.removeItem(DEV_USER_STORAGE_KEY);
      window.sessionStorage.setItem('creatordna.signed-out', '1');
    } else {
      window.localStorage.setItem(DEV_USER_STORAGE_KEY, uid);
      window.sessionStorage.removeItem('creatordna.signed-out');
    }
  } catch {
    // Private browsing / storage disabled: the session simply does not persist.
  }
}

let unsubscribe: (() => void) | null = null;

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'loading',
  user: null,
  error: null,
  pending: false,
  firebaseReady: isFirebaseConfigured,

  async init() {
    if (unsubscribe !== null) return;

    // Without Firebase there is nothing to subscribe to: restore the dev session.
    if (!isFirebaseConfigured) {
      const stored = readStoredDevUid();
      set(
        stored === null
          ? { status: 'signed-out', user: null }
          : {
              status: 'signed-in',
              user: {
                uid: stored,
                email: null,
                displayName: 'Local creator',
                emailVerified: false,
                devBypass: true,
              },
            },
      );
      return;
    }

    await new Promise<void>((resolve) => {
      unsubscribe = subscribeToAuthChanges((firebaseUser) => {
        set(
          firebaseUser === null
            ? { status: 'signed-out', user: null }
            : {
                status: 'signed-in',
                user: { ...toAuthUser(firebaseUser), devBypass: false },
              },
        );
        resolve();
      });
    });
  },

  async signInWithGoogle() {
    set({ pending: true, error: null });
    try {
      const user = await signInWithGoogle();
      set({
        status: 'signed-in',
        user: { ...toAuthUser(user), devBypass: false },
        pending: false,
      });
    } catch (error) {
      set({ error: mapAuthError(error), pending: false });
    }
  },

  async signUpWithEmail(email, password) {
    set({ pending: true, error: null });
    try {
      const user = await signUpWithEmail(email, password);
      set({
        status: 'signed-in',
        user: { ...toAuthUser(user), devBypass: false },
        pending: false,
      });
    } catch (error) {
      set({ error: mapAuthError(error), pending: false });
    }
  },

  async signInWithEmail(email, password) {
    set({ pending: true, error: null });
    try {
      const user = await signInWithEmail(email, password);
      set({
        status: 'signed-in',
        user: { ...toAuthUser(user), devBypass: false },
        pending: false,
      });
    } catch (error) {
      set({ error: mapAuthError(error), pending: false });
    }
  },

  async signInAsDevUser(uid) {
    const resolved = uid === undefined || uid.trim().length === 0 ? DEV_USER_UID : uid.trim();
    writeStoredDevUid(resolved);
    set({
      status: 'signed-in',
      user: {
        uid: resolved,
        email: null,
        displayName: 'Local creator',
        emailVerified: false,
        devBypass: true,
      },
      pending: false,
      error: null,
    });
  },

  async signOut() {
    const { user } = get();
    if (user?.devBypass === true) {
      writeStoredDevUid(null);
      set({ status: 'signed-out', user: null, error: null });
      return;
    }
    try {
      await signOutUser();
    } catch (error) {
      set({ error: mapAuthError(error) });
      return;
    }
    set({ status: 'signed-out', user: null, error: null });
  },

  clearError() {
    set({ error: null });
  },
}));

/** Test seam: forget the Firebase subscription. */
export function resetAuthStoreSubscription(): void {
  unsubscribe?.();
  unsubscribe = null;
}
