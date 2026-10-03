import {
  cert,
  deleteApp,
  getApp,
  getApps,
  initializeApp,
  type App,
  type AppOptions,
} from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getStorage, type Storage } from 'firebase-admin/storage';
import type { Logger } from 'pino';
import type { AppConfig } from '../config/index.js';

let adminApp: App | null = null;

/**
 * `.env` files cannot hold real newlines, so PEM keys arrive with literal `\n`.
 * Firebase rejects those, so normalize here (and strip stray wrapping quotes).
 */
export function normalizePrivateKey(key: string): string {
  return key.trim().replace(/^["']|["']$/g, '').replace(/\\n/g, '\n');
}

/**
 * Initializes the Firebase Admin SDK.
 *
 * Returns `null` (with a warning) when no project is configured, which is a
 * supported local-dev state: the API boots, `/health` reports
 * `firebase: not_configured`, and token verification fails with a clear 503.
 */
export function initFirebaseAdmin(config: AppConfig, logger: Logger): App | null {
  if (getApps().length > 0) {
    adminApp = getApp();
    return adminApp;
  }

  const projectId = config.env.FIREBASE_PROJECT_ID;
  const clientEmail = config.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = config.env.FIREBASE_PRIVATE_KEY;

  if (projectId === undefined) {
    logger.warn(
      'Firebase is not configured (FIREBASE_PROJECT_ID missing) - token verification is unavailable.',
    );
    return null;
  }

  const options: AppOptions = { projectId };

  if (clientEmail !== undefined && privateKey !== undefined) {
    options.credential = cert({
      projectId,
      clientEmail,
      privateKey: normalizePrivateKey(privateKey),
    });
    logger.info({ projectId, clientEmail }, 'firebase admin initialized (service account)');
  } else {
    logger.warn(
      'FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY missing - falling back to application default credentials.',
    );
    logger.info({ projectId }, 'firebase admin initialized (application default credentials)');
  }

  if (config.env.FIREBASE_STORAGE_BUCKET !== undefined) {
    options.storageBucket = config.env.FIREBASE_STORAGE_BUCKET;
  }

  adminApp = initializeApp(options);
  return adminApp;
}

export function getFirebaseApp(): App | null {
  if (adminApp !== null) return adminApp;
  if (getApps().length > 0) {
    adminApp = getApp();
    return adminApp;
  }
  return null;
}

export function getFirebaseAuth(): Auth | null {
  const app = getFirebaseApp();
  return app === null ? null : getAuth(app);
}

export function getFirestoreDb(): Firestore | null {
  const app = getFirebaseApp();
  return app === null ? null : getFirestore(app);
}

export function getStorageBucket(): Storage | null {
  const app = getFirebaseApp();
  return app === null ? null : getStorage(app);
}

export async function shutdownFirebaseAdmin(): Promise<void> {
  const app = adminApp;
  adminApp = null;
  if (app === null) return;
  // firebase-admin v13 removed App#delete() in favour of deleteApp().
  await deleteApp(app);
}
