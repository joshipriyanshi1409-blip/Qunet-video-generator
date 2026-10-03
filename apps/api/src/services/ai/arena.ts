/** Bounded text Arena. Adapters are long-lived clients supplied by the caller. */
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Cache } from '../../lib/cache.js';
import type { TextModelClient } from './types.js';

export const arenaTasks = ['hook', 'script', 'storyboard', 'visual-prompt', 'caption'] as const;
export type ArenaTask = (typeof arenaTasks)[number];
export type ArenaMode = 'fast' | 'balanced' | 'arena';

export interface ArenaModel {
  id: string;
  model: string;
  client: TextModelClient;
  tasks: readonly ArenaTask[];
  ramMb: number;
  vramMb: number;
  maxConcurrency: number;
  expectedLatencyMs: number;
}

export interface ArenaInput {
  task: ArenaTask;
  mode: ArenaMode;
  topic: string;
  creatorContext: string;
  creatorVersion: number;
  audience: string;
  format: string;
  formatVersion: number;
  instructions?: string;
  uid: string;
}

const outputSchema = z.object({ content: z.string().trim().min(1).max(8000) });
const judgeSchema = z.object({
  evaluations: z.array(z.object({
    label: z.string(),
    creatorFit: z.number().min(0).max(10),
    audienceFit: z.number().min(0).max(10),
    taskFit: z.number().min(0).max(10),
    originality: z.number().min(0).max(10),
    reason: z.string().max(300),
  })),
});

export interface ArenaResult {
  id: string;
  task: ArenaTask;
  status: 'selected';
  winner: { modelId: string; content: string; score: number; reason: string };
  candidates: { modelId: string; content: string; score?: number; latencyMs: number }[];
  judgeCalls: number;
  cacheHit: boolean;
}

export interface ArenaOptions {
  models: ArenaModel[];
  judge: ArenaModel;
  cache: Cache;
  maxConcurrency?: number;
  availableRamMb?: number;
  availableVramMb?: number;
  timeoutMs?: number;
  onProgress?: (event: { phase: 'generating' | 'candidate' | 'judging' | 'selected'; id?: string }) => void;
}

const limits: Record<ArenaTask, number> = { hook: 100, script: 2500, storyboard: 3000, 'visual-prompt': 400, caption: 300 };
const weights: Record<ArenaTask, [number, number, number, number]> = {
  hook: [0.35, 0.25, 0.25, 0.15], script: [0.35, 0.2, 0.35, 0.1],
  storyboard: [0.2, 0.15, 0.5, 0.15], 'visual-prompt': [0.2, 0.1, 0.5, 0.2],
  caption: [0.3, 0.2, 0.4, 0.1],
};

export function createArena(options: ArenaOptions) {
  const active = new Map<string, number>();
  const inflight = new Map<string, Promise<ArenaResult>>();
  const timeout = options.timeoutMs ?? 20_000;
  async function call(model: ArenaModel, system: string, user: string, tokens: number): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await model.client.generate(model.model, { system, user, json: true, maxOutputTokens: tokens }, controller.signal);
      return response.text;
    } finally { clearTimeout(timer); }
  }
  function eligible(task: ArenaTask): ArenaModel[] {
    return options.models.filter((m) => m.tasks.includes(task) && m.maxConcurrency > (active.get(m.id) ?? 0) &&
      m.ramMb <= (options.availableRamMb ?? Infinity) && m.vramMb <= (options.availableVramMb ?? Infinity))
      .sort((a, b) => a.expectedLatencyMs - b.expectedLatencyMs);
  }
  async function run(input: ArenaInput): Promise<ArenaResult> {
    const key = createHash('sha256').update(JSON.stringify({ v: 1, input, models: options.models.map(m => [m.id, m.model]), judge: options.judge.model })).digest('hex');
    const existing = inflight.get(key);
    if (existing) return existing;
    const work = async (): Promise<ArenaResult> => {
      const cached = await options.cache.get<ArenaResult>(`arena:${key}`);
      if (cached) return { ...cached, cacheHit: true };
      const selected = eligible(input.task).slice(0, Math.min(Math.max(1, options.maxConcurrency ?? 3), input.mode === 'fast' ? 1 : input.mode === 'balanced' ? 2 : 3));
      if (!selected.length) throw new Error(`No available models for ${input.task}`);
      const system = `Create a ${input.task} for a short video. Return JSON {"content":"..."}. Limit content to ${limits[input.task]} characters. Creator style: ${input.creatorContext}. Format: ${input.format}. Audience: ${input.audience}.`;
      const user = `Topic: ${input.topic}\n${input.instructions ?? ''}`;
      options.onProgress?.({ phase: 'generating' });
      const candidates: ArenaResult['candidates'] = [];
      // Reserve before starting the calls, so concurrent battles cannot overbook a worker.
      const runnable = selected.filter(m => (active.get(m.id) ?? 0) < m.maxConcurrency && (active.set(m.id, (active.get(m.id) ?? 0) + 1), true));
      await Promise.all(runnable.map(async m => {
        const start = Date.now();
        try {
          const parsed = outputSchema.parse(JSON.parse(await call(m, system, user, Math.ceil(limits[input.task] / 3))));
          if (parsed.content.length > limits[input.task]) throw new Error('Output exceeds task limit');
          candidates.push({ modelId: m.id, content: parsed.content, latencyMs: Date.now() - start });
          options.onProgress?.({ phase: 'candidate', id: m.id });
        } catch { /* One failed contestant does not fail the battle. */ }
        finally { active.set(m.id, (active.get(m.id) ?? 1) - 1); }
      }));
      if (!candidates.length) throw new Error('All Arena contestants failed');
      let judgeCalls = 0;
      let winner = { modelId: candidates[0]!.modelId, content: candidates[0]!.content, score: 0, reason: 'Only valid candidate' };
      if (candidates.length > 1) {
        options.onProgress?.({ phase: 'judging' });
        const shuffled = [...candidates];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
        }
        const labels = shuffled.map((_, i) => String.fromCharCode(65 + i));
        try {
          judgeCalls++;
          const raw = await call(options.judge,
            `Evaluate all candidates for THIS creator, audience, format and task. Return JSON {"evaluations":[{"label":"A","creatorFit":0,"audienceFit":0,"taskFit":0,"originality":0,"reason":"..."}]}. Score each 0-10. Do not infer model identities. Creator: ${input.creatorContext}; audience: ${input.audience}; format: ${input.format}; task: ${input.task}.`,
            shuffled.map((c, i) => `${labels[i]}: ${c.content}`).join('\n'), 600);
          const evaluations = judgeSchema.parse(JSON.parse(raw)).evaluations;
          if (evaluations.length !== candidates.length || new Set(evaluations.map(e => e.label)).size !== candidates.length || evaluations.some(e => !labels.includes(e.label))) throw new Error('Incomplete judge response');
          const w = weights[input.task];
          const ranked = evaluations.map(e => {
            const c = shuffled[labels.indexOf(e.label)]!;
            const score = Math.round(10 * (e.creatorFit * w[0] + e.audienceFit * w[1] + e.taskFit * w[2] + e.originality * w[3]));
            c.score = score;
            return { modelId: c.modelId, content: c.content, score, reason: e.reason };
          }).sort((a, b) => b.score - a.score);
          winner = ranked[0]!;
        } catch { throw new Error('Arena judge failed; no unjudged winner selected'); }
      }
      const result: ArenaResult = { id: randomUUID(), task: input.task, status: 'selected', winner, candidates, judgeCalls, cacheHit: false };
      await options.cache.set(`arena:${key}`, result, 24 * 60 * 60 * 1000);
      options.onProgress?.({ phase: 'selected', id: winner.modelId });
      return result;
    };
    const promise = work();
    inflight.set(key, promise);
    try { return await promise; } finally { inflight.delete(key); }
  }
  return { run, eligible };
}
