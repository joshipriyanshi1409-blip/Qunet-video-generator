import { Router } from 'express';
import { z } from 'zod';
import { CONTENT_FORMATS, buildDnaContext } from '@creatordna/shared';
import { requireAuth, type AuthOptions } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../lib/http.js';
import rateLimit from 'express-rate-limit';
import type { DnaRepository } from '../lib/dnaRepository.js';
import type { ArenaModel, ArenaTask } from '../services/ai/arena.js';
import { createArena, arenaTasks } from '../services/ai/arena.js';
import type { Cache } from '../lib/cache.js';

const runSchema = z.object({ task: z.enum(arenaTasks).refine(v => v === 'hook' || v === 'script'),
  mode: z.enum(['fast', 'balanced', 'arena']), topic: z.string().trim().min(1).max(500),
  formatId: z.string().trim().min(1).max(60), audience: z.string().trim().max(300).default(''),
  instructions: z.string().trim().max(1000).optional() });

export function createArenaRouter(options: { auth: AuthOptions; dna: DnaRepository; cache: Cache; models: ArenaModel[]; judge: ArenaModel }): Router {
  const router = Router();
  const arena = createArena({ models: options.models, judge: options.judge, cache: options.cache });
  router.get('/models', requireAuth(options.auth), (_req, res) => {
    res.json({ data: options.models.map(m => ({ id: m.id, tasks: m.tasks, available: arena.eligible('hook').some(e => e.id === m.id) || arena.eligible('script').some(e => e.id === m.id) })) });
  });
  router.post('/run', requireAuth(options.auth), rateLimit({ windowMs: 60_000, limit: 8, standardHeaders: 'draft-7', legacyHeaders: false }), validate({ body: runSchema }), asyncHandler(async (req, res) => {
    const body = runSchema.parse(req.body as unknown);
    const format = CONTENT_FORMATS.find(f => f.id === body.formatId);
    if (!format) { res.status(422).json({ error: { code: 'invalid_format', message: 'Unknown content format' } }); return; }
    const uid = req.user!.uid;
    const dna = await options.dna.get(uid);
    if (!dna) { res.status(422).json({ error: { code: 'dna_required', message: 'Complete Creator DNA onboarding first' } }); return; }
    const context = buildDnaContext({ uid, dna });
    const result = await arena.run({ task: body.task as ArenaTask, mode: body.mode, uid, topic: body.topic,
      audience: body.audience, format: `${format.name}: ${format.description}; pacing ${format.pacing}; narration ${format.narrationStyle}; hook styles ${format.hookStyles.join(', ')}`,
      formatVersion: 1, creatorContext: context.text, creatorVersion: dna.dnaVersion,
      instructions: body.instructions });
    res.json({ data: result });
  }));
  return router;
}
