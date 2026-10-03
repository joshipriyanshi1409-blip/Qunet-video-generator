import type { RequestHandler } from 'express';
import {
  dnaOnboardingInputSchema,
  dnaUpdateRequestSchema,
  type DnaOnboardingInput,
  type DnaUpdateRequest,
} from '@creatordna/shared';
import type { DnaService } from '../services/dna.service.js';
import { asyncHandler } from '../lib/http.js';

export interface DnaController {
  extract: RequestHandler;
  getProfile: RequestHandler;
  update: RequestHandler;
  getContext: RequestHandler;
}

/** Shape of `GET /dna/context` - the block injected into every prompt. */
interface DnaContextBody {
  context: string;
  tokens: number;
  truncated: boolean;
  historyItemsUsed: number;
}

export function createDnaController(service: DnaService): DnaController {
  return {
    extract: asyncHandler(async (req, res) => {
      const uid = requireUid(req);
      // Re-parse in the controller: `req.body` is `any` and the route's
      // `validate()` middleware is a boundary, not a type.
      const input = dnaOnboardingInputSchema.parse(req.body as unknown) as DnaOnboardingInput;
      // An upsert keyed on the creator: 200 whether it created or updated.
      const result = await service.extract(uid, input);
      res.json({ data: result });
    }),

    getProfile: asyncHandler(async (req, res) => {
      const uid = requireUid(req);
      res.json({ data: await service.getProfile(uid) });
    }),

    update: asyncHandler(async (req, res) => {
      const uid = requireUid(req);
      const patch = dnaUpdateRequestSchema.parse(req.body as unknown) as DnaUpdateRequest;
      res.json({ data: await service.update(uid, patch) });
    }),

    getContext: asyncHandler(async (req, res) => {
      const uid = requireUid(req);
      const context = await service.buildContext(uid);
      const body: DnaContextBody = {
        context: context.text,
        tokens: context.tokens,
        truncated: context.truncated,
        historyItemsUsed: context.historyItemsUsed,
      };
      res.json({ data: body });
    }),
  };
}

/** `requireAuth` guarantees `req.user`; this keeps the controllers honest. */
function requireUid(req: Parameters<RequestHandler>[0]): string {
  const user = req.user;
  if (user === undefined) {
    throw new Error('requireUid called without authenticated user');
  }
  return user.uid;
}
