import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth';

/**
 * Firebase client init + auth operations.
 *
 * Everything is read from `VITE_FIREBASE_*` env vars, and the module stays inert
 * when they are missing so the UI runs (and is testable) without a Firebase
 * project. In that state the Login screen offers a dev-only bypass that talks to
 * the API's `x-dev-uid` header instead.
 */

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const isFirebaseConfigured: boolean =
  typeof firebaseConfig.apiKey === 'string' && firebaseConfig.apiKey.length > 0;

let app: FirebaseApp | null = null;

export function getFirebaseApp(): FirebaseApp | null {
  if (!isFirebaseConfigured) return null;
  if (app !== null) return app;
  app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  return app;
}

export function getFirebaseAuth(): Auth | null {
  const firebaseApp = getFirebaseApp();
  return firebaseApp === null ? null : getAuth(firebaseApp);
}

/** ID token for the signed-in user, or `null` when nobody is signed in. */
export async function getIdToken(): Promise<string | null> {
  const auth = getFirebaseAuth();
  if (auth === null || auth.currentUser === null) return null;
  return auth.currentUser.getIdToken();
}

/** Firebase error codes, mapped to something a creator can act on. */
const AUTH_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  'auth/invalid-email': 'That email address does not look right.',
  'auth/user-disabled': 'This account has been disabled.',
  'auth/user-not-found': 'No account found for that email.',
  'auth/wrong-password': 'That password is incorrect.',
  'auth/invalid-credential': 'That email or password is incorrect.',
  'auth/email-already-in-use': 'An account already exists for that email. Try signing in.',
  'auth/weak-password': 'Passwords need at least 6 characters.',
  'auth/popup-closed-by-user': 'The Google window was closed before signing in.',
  'auth/popup-blocked': 'Your browser blocked the Google window. Allow pop-ups and try again.',
  'auth/cancelled-popup-request': 'The Google sign-in was cancelled.',
  'auth/network-request-failed': 'Network problem - check your connection and try again.',
  'auth/too-many-requests': 'Too many attempts. Wait a minute and try again.',
  'auth/operation-not-allowed':
    'Email/password sign-in is not enabled for this Firebase project.',
  'auth/unauthorized-domain':
    'This domain is not authorised in the Firebase console (Authentication > Settings > Authorized domains).',
};

export function mapAuthError(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && AUTH_ERROR_MESSAGES[code] !== undefined) {
      return AUTH_ERROR_MESSAGES[code] as string;
    }
  }
  if (error instanceof Error && error.message.length > 0) return error.message;
  return 'Something went wrong. Please try again.';
}

/** Throws when Firebase is not configured, so callers can branch on it. */
function requireAuth(): Auth {
  const auth = getFirebaseAuth();
  if (auth === null) {
    throw new Error('Firebase is not configured (missing VITE_FIREBASE_* variables).');
  }
  return auth;
}

export async function signInWithGoogle(): Promise<User> {
  const auth = requireAuth();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const credential = await signInWithPopup(auth, provider);
  return credential.user;
}

export async function signUpWithEmail(email: string, password: string): Promise<User> {
  const auth = requireAuth();
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  return credential.user;
}

export async function signInWithEmail(email: string, password: string): Promise<User> {
  const auth = requireAuth();
  const credential = await signInWithEmailAndPassword(auth, email, password);
  return credential.user;
}

export async function signOutUser(): Promise<void> {
  const auth = getFirebaseAuth();
  if (auth === null) return;
  await signOut(auth);
}

/** Subscribes to Firebase auth changes. Returns the unsubscribe function. */
export function subscribeToAuthChanges(listener: (user: User | null) => void): () => void {
  const auth = getFirebaseAuth();
  if (auth === null) return () => undefined;
  return onAuthStateChanged(auth, listener);
}

/** Firebase user -> the shape the auth store exposes. */
export function toAuthUser(user: User): {
  uid: string;
  email: string | null;
  displayName: string | null;
  emailVerified: boolean;
} {
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    emailVerified: user.emailVerified,
  };
}
