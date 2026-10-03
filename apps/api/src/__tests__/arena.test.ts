import { describe, expect, it } from 'vitest';
import { createArena, type ArenaInput, type ArenaModel } from '../services/ai/arena.js';
import { createCache } from '../lib/cache.js';
import type { TextModelClient } from '../services/ai/types.js';

const input: ArenaInput = { task: 'hook', mode: 'arena', topic: 'AI agents', creatorContext: 'blunt', creatorVersion: 1, audience: 'developers', format: 'tech-explainer', formatVersion: 1, uid: 'creator' };
const response = (text: string, model: string) => ({ text, model, promptTokens: 1, completionTokens: 1 });

describe('text arena', () => {
  it('runs contestants concurrently, judges once without model identities and caches', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let started = 0;
    let judgeCalls = 0;
    const clients: ArenaModel[] = [0, 1, 2].map(i => ({
      id: `private-model-${i}`, model: `model-${i}`, tasks: ['hook'], ramMb: 100, vramMb: 0, maxConcurrency: 1, expectedLatencyMs: i,
      client: { name: 'test', async generate() { started++; await gate; return response(JSON.stringify({ content: `Hook ${i}` }), `model-${i}`); } },
    }));
    const judge: ArenaModel = {
      ...clients[0]!, id: 'judge', client: { name: 'judge', async generate(_model, request) {
        judgeCalls++;
        expect(request.user).not.toContain('private-model');
        expect(request.user).toContain('A:');
        return response(JSON.stringify({ evaluations: ['A', 'B', 'C'].map(label => ({ label, creatorFit: 8, audienceFit: 8, taskFit: 8, originality: 8, reason: 'Fits' })) }), 'judge');
      } },
    };
    const arena = createArena({ models: clients, judge, cache: createCache(), availableRamMb: 200 });
    const pending = arena.run(input);
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(started).toBe(3);
    release();
    const result = await pending;
    expect(result.candidates).toHaveLength(3);
    expect(result.judgeCalls).toBe(1);
    expect(judgeCalls).toBe(1);
    expect((await arena.run(input)).cacheHit).toBe(true);
    expect(started).toBe(3);
  });

  it('fast mode uses one model without judging and skips unavailable hardware', async () => {
    const client: TextModelClient = { name: 'test', async generate() { return response('{"content":"A hook"}', 'small'); } };
    const small: ArenaModel = { id: 'small', model: 'small', client, tasks: ['hook'], ramMb: 100, vramMb: 0, maxConcurrency: 1, expectedLatencyMs: 1 };
    const large = { ...small, id: 'large', ramMb: 10000 };
    const arena = createArena({ models: [large, small], judge: large, cache: createCache(), availableRamMb: 200 });
    expect(arena.eligible('hook').map(m => m.id)).toEqual(['small']);
    const result = await arena.run({ ...input, mode: 'fast' });
    expect(result.winner.modelId).toBe('small');
    expect(result.judgeCalls).toBe(0);
  });
});
