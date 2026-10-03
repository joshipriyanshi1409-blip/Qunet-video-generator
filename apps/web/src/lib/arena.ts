import { z } from 'zod';
import { request } from './api';

const resultSchema = z.object({ id: z.string(), task: z.string(), status: z.literal('selected'), cacheHit: z.boolean(), judgeCalls: z.number(),
  winner: z.object({ modelId: z.string(), content: z.string(), score: z.number(), reason: z.string() }),
  candidates: z.array(z.object({ modelId: z.string(), content: z.string(), score: z.number().optional(), latencyMs: z.number() })) });

export function runArena(input: { task: 'hook' | 'script'; mode: 'fast' | 'balanced' | 'arena'; topic: string; formatId: string; audience: string; instructions?: string }) {
  return request('/api/v1/arena/run', resultSchema, { method: 'POST', body: input });
}
