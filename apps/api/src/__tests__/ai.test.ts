import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createLogger } from '@creatordna/shared/logger';
import {
  AiClientError,
  AiValidationError,
  createTextModelService,
  parseJson,
  type TextModelClient,
  type TextModelRequest,
  type TextModelResponse,
} from '../services/ai/index.js';

const logger = createLogger({ level: 'silent' });

const outputSchema = z.object({
  hook: z.string().min(1),
  seconds: z.number().int().positive(),
});

/**
 * Per-model response queue: each model gets its own list, consumed in order, so
 * a test can make the primary fail and the fallback succeed.
 */
type ResponseQueue = ReadonlyArray<TextModelResponse | Error>;

function fakeClient(byModel: Record<string, ResponseQueue>): TextModelClient & {
  calls: Array<{ model: string; request: TextModelRequest }>;
} {
  const calls: Array<{ model: string; request: TextModelRequest }> = [];
  const cursors = new Map<string, number>();

  return {
    name: 'fake',
    calls,
    async generate(model, request) {
      calls.push({ model, request });
      const queue = byModel[model] ?? [];
      const cursor = cursors.get(model) ?? 0;
      cursors.set(model, cursor + 1);
      const next = queue[Math.min(cursor, queue.length - 1)];
      if (next === undefined) throw new Error(`fake client has no response for ${model}`);
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

const PRIMARY = 'primary-model';
const FALLBACK = 'fallback-model';

function ok(text: string, model = PRIMARY, overrides: Partial<TextModelResponse> = {}): TextModelResponse {
  return { text, promptTokens: 100, completionTokens: 50, model, ...overrides };
}

const messages = { system: 'system prompt', user: 'user prompt' };
const meta = {
  schema: outputSchema,
  promptId: 'dna-extract',
  promptVersion: 1,
  uid: 'uid_1',
  operation: 'test',
};

function makeService(
  client: TextModelClient,
  overrides: Partial<Parameters<typeof createTextModelService>[0]> = {},
) {
  return createTextModelService({
    client,
    logger,
    primaryModel: PRIMARY,
    sleep: async () => undefined,
    now: (() => {
      let time = 0;
      return () => (time += 10);
    })(),
    ...overrides,
  });
}

describe('parseJson', () => {
  it('parses plain JSON', () => {
    expect(parseJson('{"hook":"hi","seconds":3}')).toEqual({ hook: 'hi', seconds: 3 });
  });

  it('strips markdown code fences', () => {
    expect(parseJson('```json\n{"hook":"hi","seconds":3}\n```')).toEqual({
      hook: 'hi',
      seconds: 3,
    });
  });

  it('returns a marker object instead of throwing on garbage', () => {
    const parsed = parseJson('not json at all') as Record<string, unknown>;
    expect(parsed['__unparsable__']).toBe('not json at all');
  });
});

describe('createTextModelService', () => {
  it('returns validated data and logs usage', async () => {
    const client = fakeClient({ [PRIMARY]: [ok('{"hook":"hi","seconds":3}')] });
    const service = makeService(client);

    const result = await service.callJson(messages, meta);

    expect(result.data).toEqual({ hook: 'hi', seconds: 3 });
    expect(result.reprompted).toBe(false);
    expect(result.usage).toMatchObject({
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      model: 'primary-model',
      usedFallback: false,
    });
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.request.json).toBe(true);
  });

  it('re-prompts once with the validation error, then succeeds', async () => {
    const client = fakeClient({
      [PRIMARY]: [
        ok('{"hook":"hi"}'), // missing "seconds"
        ok('{"hook":"hi","seconds":3}'),
      ],
    });
    const service = makeService(client);

    const result = await service.callJson(messages, meta);

    expect(result.data).toEqual({ hook: 'hi', seconds: 3 });
    expect(result.reprompted).toBe(true);
    expect(client.calls).toHaveLength(2);
    expect(client.calls[1]?.request.user).toContain('Your previous answer was rejected');
    expect(client.calls[1]?.request.user).toContain('seconds');
    // The original prompt is preserved, not replaced.
    expect(client.calls[1]?.request.user).toContain('user prompt');
  });

  it('fails gracefully after the single re-prompt', async () => {
    const client = fakeClient({
      [PRIMARY]: [ok('{"hook":"hi"}'), ok('{"hook":"still missing seconds"}')],
    });
    const service = makeService(client);

    await expect(service.callJson(messages, meta)).rejects.toThrow(AiValidationError);
    expect(client.calls).toHaveLength(2);
  });

  it('surfaces the zod issues on the validation error', async () => {
    const client = fakeClient({ [PRIMARY]: [ok('{"hook":"hi"}')] });
    const service = makeService(client);

    const error = await service.callJson(messages, meta).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AiValidationError);
    expect((error as AiValidationError).issues.join(' ')).toContain('seconds');
  });

  it('retries a retryable failure with backoff', async () => {
    const client = fakeClient({
      [PRIMARY]: [new AiClientError('503 upstream', true), ok('{"hook":"hi","seconds":3}')],
    });
    const sleep = vi.fn(async () => undefined);
    const service = makeService(client, { maxAttempts: 3, sleep });

    const result = await service.callJson<{ hook: string; seconds: number }>(messages, meta);

    expect(result.data.hook).toBe('hi');
    expect(client.calls).toHaveLength(2);
    expect(sleep).toHaveBeenCalledWith(250);
  });

  it('does not retry a non-retryable failure', async () => {
    const client = fakeClient({ [PRIMARY]: [new AiClientError('400 bad request', false)] });
    const sleep = vi.fn(async () => undefined);
    const service = makeService(client, { sleep });

    await expect(service.callJson(messages, meta)).rejects.toThrow('400 bad request');
    expect(client.calls).toHaveLength(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('falls back to the fallback model when the primary is down', async () => {
    const client = fakeClient({
      [PRIMARY]: [new AiClientError('503 primary', true)],
      [FALLBACK]: [ok('{"hook":"hi","seconds":3}', FALLBACK)],
    });
    const service = makeService(client, { fallbackModel: FALLBACK });

    const result = await service.callJson(messages, meta);

    expect(result.usage.model).toBe(FALLBACK);
    expect(result.usage.usedFallback).toBe(true);
    // Default maxAttempts is 2, so the primary is tried twice before the
    // wrapper gives up on it and moves to the fallback.
    expect(client.calls.map((call) => call.model)).toEqual([PRIMARY, PRIMARY, FALLBACK]);
  });

  it('throws when every model fails', async () => {
    const client = fakeClient({
      [PRIMARY]: [new AiClientError('503 primary', true)],
      [FALLBACK]: [new AiClientError('503 fallback', true)],
    });
    const service = makeService(client, { fallbackModel: FALLBACK });

    await expect(service.callJson(messages, meta)).rejects.toThrow('503 fallback');
  });

  it('estimates cost when prices are configured', async () => {
    const client = fakeClient({ [PRIMARY]: [ok('{"hook":"hi","seconds":3}')] });
    const service = makeService(client, {
      inputPricePer1k: 0.01,
      outputPricePer1k: 0.03,
    });

    const result = await service.callJson(messages, meta);

    // 100 prompt + 50 completion tokens at $0.01 / $0.03 per 1k.
    expect(result.usage.estimatedCostUsd).toBeCloseTo(0.0025, 6);
  });

  it('omits the cost estimate when no prices are configured', async () => {
    const client = fakeClient({ [PRIMARY]: [ok('{"hook":"hi","seconds":3}')] });
    const service = makeService(client);

    const result = await service.callJson(messages, meta);
    expect(result.usage.estimatedCostUsd).toBeUndefined();
  });

  it('passes temperature and max output tokens through', async () => {
    const client = fakeClient({ [PRIMARY]: [ok('{"hook":"hi","seconds":3}')] });
    const service = makeService(client, { temperature: 0.2, maxOutputTokens: 512 });

    await service.callJson(messages, meta);

    expect(client.calls[0]?.request.temperature).toBe(0.2);
    expect(client.calls[0]?.request.maxOutputTokens).toBe(512);
  });

  it('normalises an unexpected adapter error into AiClientError', async () => {
    // A TypeError from a buggy adapter must become `ai_unavailable` (503), not a
    // generic 500 - the API never reports an internal error for a model call.
    const client: TextModelClient = {
      name: 'buggy',
      generate: async () => {
        throw new TypeError('cannot read properties of undefined');
      },
    };

    await expect(makeService(client, { maxAttempts: 1 }).callJson(messages, meta)).rejects.toThrow(
      AiClientError,
    );
  });

  it('aborts the request when the timeout fires', async () => {
    const signals: Array<AbortSignal | undefined> = [];
    const client: TextModelClient = {
      name: 'slow',
      async generate(_model, _request, signal) {
        signals.push(signal);
        return new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        });
      },
    };

    const service = makeService(client, { timeoutMs: 5, maxAttempts: 1 });

    await expect(service.callJson(messages, meta)).rejects.toThrow();
    expect(signals[0]?.aborted).toBe(true);
  });
});
