import type { RequestHandler } from 'express';
import {
  hookLabRequestSchema,
  trendRemixRequestSchema,
  type Hook,
  type TrendListResponse,
  type TrendRemix,
} from '@creatordna/shared';
import type { TrendService } from '../services/trend.service.js';
import { asyncHandler } from '../lib/http.js';

export interface TrendController {
  listForMe: RequestHandler;
  remix: RequestHandler;
  hooks: RequestHandler;
  seed: RequestHandler;
}

export function createTrendController(service: TrendService): TrendController {
  return {
    listForMe: asyncHandler(async (req, res) => {
      const uid = requireUid(req);
      const result: TrendListResponse = await service.listForMe(uid);
      res.json({ data: result });
    }),

    remix: asyncHandler(async (req, res) => {
      const uid = requireUid(req);
      const request = trendRemixRequestSchema.parse(req.body as unknown);
      const remix: TrendRemix = await service.remix(uid, request);
      res.json({ data: remix });
    }),

    hooks: asyncHandler(async (req, res) => {
      const uid = requireUid(req);
      const request = hookLabRequestSchema.parse(req.body as unknown);
      const hooks: Hook[] = await service.hooks(uid, {
        idea: request.idea,
        trendId: request.trendId,
        count: request.count,
        regenerateStyle: request.regenerateStyle,
      });
      res.json({ data: { hooks } });
    }),

    /** Idempotent catalogue seeding; safe to call on every boot. */
    seed: asyncHandler(async (_req, res) => {
      const written = await service.seed();
      res.json({ data: { written } });
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
