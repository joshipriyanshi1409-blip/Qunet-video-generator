import type { Request, RequestHandler } from 'express';
import { DEV_AUTH_UID_HEADER } from '@creatordna/shared';
import { ServiceUnavailableError, UnauthorizedError } from '../lib/errors.js';
import { getFirebaseAuth } from '../lib/firebase-admin.js';
import type { AppConfig } from '../config/index.js';
import type { Logger } from 'pino';

/** The authenticated caller, attached to `req.user`. */
export interface AuthUser {
  uid: string;
  email?: string;
  emailVerified: boolean;
  claims: Record<string, unknown>;
}

/** Verifies a Firebase ID token. Injectable so tests never touch Firebase. */
export type TokenVerifier = (token: string) => Promise<AuthUser>;

export interface AuthOptions {
  config: AppConfig;
  logger: Logger;
  verifyToken: TokenVerifier;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

/** Verifies a Firebase ID token against the Admin SDK. */
export async function verifyIdToken(token: string): Promise<AuthUser> {
  const auth = getFirebaseAuth();
  if (auth === null) {
    throw new ServiceUnavailableError(
      'service_unavailable',
      'Firebase authentication is not configured on this server.',
    );
  }
  const decoded = await auth.verifyIdToken(token);
  return {
    uid: decoded.uid,
    email: decoded.email,
    emailVerified: decoded.email_verified === true,
    claims: { ...decoded },
  };
}

function extractBearerToken(req: Request): string | null {
  // `req.get()` is properly typed (`string | undefined`), unlike indexing
  // `req.headers.authorization` directly.
  const header = req.get('authorization');
  if (header === undefined) return null;
  const [scheme, ...rest] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer') return null;
  const token = rest.join(' ').trim();
  return token.length > 0 ? token : null;
}

/**
 * Dev-only identity source.
 *
 * Honoured **only** when `DEV_AUTH_BYPASS=true` (which the env schema refuses in
 * production). Returns `null` when the bypass is off or no header was sent.
 */
export function devBypassUser(req: Request, options: AuthOptions): AuthUser | null {
  if (!options.config.env.DEV_AUTH_BYPASS) return null;
  const header = req.headers[DEV_AUTH_UID_HEADER];
  const value = Array.isArray(header) ? header[0] : header;
  if (value === undefined || value.trim().length === 0) return null;
  return {
    uid: value.trim().slice(0, 128),
    emailVerified: false,
    claims: { devBypass: true },
  };
}

/** Rejects the request unless a valid Firebase ID token (or dev bypass) is present. */
export function requireAuth(options: AuthOptions): RequestHandler {
  return (req, _res, next) => {
    const bypass = devBypassUser(req, options);
    if (bypass !== null) {
      options.logger.debug({ uid: bypass.uid }, 'dev auth bypass accepted');
      req.user = bypass;
      next();
      return;
    }

    const token = extractBearerToken(req);
    if (token === null) {
      next(new UnauthorizedError('Missing Bearer token in the Authorization header.'));
      return;
    }

    void options
      .verifyToken(token)
      .then((user) => {
        req.user = user;
        next();
      })
      .catch((error: unknown) => {
        next(error);
      });
  };
}

/** Attaches the user when present, but never rejects. */
export function optionalAuth(options: AuthOptions): RequestHandler {
  return (req, _res, next) => {
    const bypass = devBypassUser(req, options);
    if (bypass !== null) {
      req.user = bypass;
      next();
      return;
    }
    const token = extractBearerToken(req);
    if (token === null) {
      next();
      return;
    }
    void options
      .verifyToken(token)
      .then((user) => {
        req.user = user;
        next();
      })
      .catch(() => {
        next();
      });
  };
}
