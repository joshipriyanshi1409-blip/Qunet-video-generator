import type { RequestHandler } from 'express';
import { meResponseSchema } from '@creatordna/shared';
import { UnauthorizedError } from '../lib/errors.js';
import { asyncHandler } from '../lib/http.js';

export interface MeController {
  getMe: RequestHandler;
}

/**
 * Returns the verified caller. Doubles as the "is my token actually being
 * verified?" probe while building the frontend.
 */
export function createMeController(): MeController {
  return {
    getMe: asyncHandler((req, res) => {
      const user = req.user;
      if (user === undefined) {
        throw new UnauthorizedError();
      }
      res.json(
        meResponseSchema.parse({
          uid: user.uid,
          email: user.email,
          emailVerified: user.emailVerified,
          // True only when THIS request was authenticated through the dev bypass.
          devAuthBypass: user.claims.devBypass === true,
          claims: user.claims,
        }),
      );
    }),
  };
}
