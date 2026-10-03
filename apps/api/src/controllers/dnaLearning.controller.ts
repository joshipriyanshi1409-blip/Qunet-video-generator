import type { RequestHandler } from 'express';
import {
  dnaSignalAppendSchema,
  type DnaSignalAppend,
  type DnaSuggestionStatus,
} from '@creatordna/shared';
import type { DnaLearningService } from '../services/dnaLearning.service.js';
import { asyncHandler } from '../lib/http.js';

export interface DnaLearningController {
  recordSignal: RequestHandler;
  listSignals: RequestHandler;
  generate: RequestHandler;
  listSuggestions: RequestHandler;
  accept: RequestHandler;
  reject: RequestHandler;
  listVersions: RequestHandler;
}

export function createDnaLearningController(service: DnaLearningService): DnaLearningController {
  return {
    recordSignal: asyncHandler(async (req, res) => {
      const uid = requireUid(req);
      const input = dnaSignalAppendSchema.parse(req.body as unknown) as DnaSignalAppend;
      // 201: a signal is a new record, not a replacement of anything.
      res.status(201).json({ data: await service.recordSignal(uid, input) });
    }),

    listSignals: asyncHandler(async (req, res) => {
      const uid = requireUid(req);
      const limit = parseLimit(req.query.limit, 50);
      res.json({ data: { signals: await service.listSignals(uid, limit) } });
    }),

    generate: asyncHandler(async (req, res) => {
      const uid = requireUid(req);
      const result = await service.generateSuggestions(uid);
      res.json({
        data: {
          suggestions: result.suggestions,
          skipped: result.skipped,
          reason: result.reason ?? null,
        },
      });
    }),

    listSuggestions: asyncHandler(async (req, res) => {
      const uid = requireUid(req);
      const status = parseStatus(req.query.status);
      res.json({ data: { suggestions: await service.listSuggestions(uid, status) } });
    }),

    accept: asyncHandler(async (req, res) => {
      const uid = requireUid(req);
      const id = requireId(req.params.id);
      // The accepted profile comes back whole, so the UI can re-render the ring
      // and the injected context without a second round trip.
      res.json({ data: await service.acceptSuggestion(uid, id) });
    }),

    reject: asyncHandler(async (req, res) => {
      const uid = requireUid(req);
      const id = requireId(req.params.id);
      res.json({ data: await service.rejectSuggestion(uid, id) });
    }),

    listVersions: asyncHandler(async (req, res) => {
      const uid = requireUid(req);
      const limit = parseLimit(req.query.limit, 20);
      res.json({ data: await service.listVersions(uid, limit) });
    }),
  };
}

function requireUid(req: Parameters<RequestHandler>[0]): string {
  const user = req.user;
  if (user === undefined) {
    throw new Error('requireUid called without authenticated user');
  }
  return user.uid;
}

function requireId(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('requireId called without a suggestion id');
  }
  return value.trim();
}

/**
 * Express query values arrive as `string | string[] | ParsedQs | undefined`.
 * Narrowed through `unknown` so no `any` reaches a variable.
 */
function firstQueryValue(value: unknown): unknown {
  if (Array.isArray(value) === true) {
    const list: unknown[] = value as unknown[];
    return list[0];
  }
  return value;
}

/** Query params arrive as `string | string[] | undefined`; never trust the shape. */
function parseLimit(value: unknown, fallback: number): number {
  const raw = firstQueryValue(value);
  const parsed = typeof raw === 'string' ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 100) : fallback;
}

const STATUSES: readonly DnaSuggestionStatus[] = ['pending', 'accepted', 'rejected'];

function parseStatus(value: unknown): DnaSuggestionStatus | undefined {
  const raw = firstQueryValue(value);
  return typeof raw === 'string' && (STATUSES as readonly string[]).includes(raw)
    ? (raw as DnaSuggestionStatus)
    : undefined;
}
