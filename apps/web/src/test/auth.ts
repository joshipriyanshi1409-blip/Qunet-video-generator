import { useAuthStore } from '../store/useAuthStore';

/**
 * Test helpers for the auth-gated screens.
 *
 * The app signs a creator in through the same code path production uses: with
 * no Firebase project configured, `useAuthStore.init()` restores a dev session
 * from `localStorage`. Writing that key is therefore the cheapest honest way to
 * render a signed-in app in a test.
 */

/** Must match `DEV_USER_STORAGE_KEY` in `store/useAuthStore.ts`. */
const DEV_USER_STORAGE_KEY = 'creatordna.dev-uid';

export const TEST_UID = 'creator-a';

export function signInAsTestCreator(uid: string = TEST_UID): void {
  window.localStorage.setItem(DEV_USER_STORAGE_KEY, uid);
  useAuthStore.setState({
    status: 'signed-in',
    user: {
      uid,
      email: null,
      displayName: 'Local creator',
      emailVerified: false,
      devBypass: true,
    },
  });
}

export function signOutTestCreator(): void {
  window.localStorage.removeItem(DEV_USER_STORAGE_KEY);
  useAuthStore.setState({ status: 'signed-out', user: null });
}
