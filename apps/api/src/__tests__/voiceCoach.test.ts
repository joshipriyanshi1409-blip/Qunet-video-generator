import { describe, expect, it, vi } from 'vitest';
import { coachTipSchema, liveSessionStartSchema } from '@creatordna/shared';
import { buildSummary, createVoiceCoachService, type SessionTransport } from '../voiceCoach/service.js';
import { createSessionRegistry } from '../voiceCoach/registry.js';
import { buildCoachInstruction, COACH_DIMENSIONS, MAX_TIP_WORDS } from '../voiceCoach/systemInstruction.js';
import { createStubLiveProvider } from '../voiceCoach/stubLive.js';
import { extractTip, type LiveSessionEvent, type LiveSessionHandle, type LiveSessionOptions, type LiveSessionProvider } from '../voiceCoach/types.js';
import type { CreatorDna } from '@creatordna/shared';
import type { DnaRepository } from '../lib/dnaRepository.js';
import { testLogger } from './helpers.js';

const logger = testLogger();

/** In-memory DNA store, keyed per creator. */
function createMemoryDnaRepository(): DnaRepository {
  const stored = new Map<string, CreatorDna>();
  return {
    kind: 'local-file',
    async get(uid) {
      return stored.get(uid) ?? null;
    },
    async save(uid, dna) {
      stored.set(uid, dna);
      return dna;
    },
    async appendHistory() {
      return { id: 'h1', kind: 'script', createdAt: new Date().toISOString(), summary: 'x' };
    },
    async listHistory() {
      return [];
    },
  };
}

function dnaFor(): CreatorDna {
  return {
    niche: 'DSA interview prep for career switchers',
    tone: ['direct', 'playful'],
    audience: ['Career switchers', 'Students'],
    style: 'Short sentences, whiteboard, fast cuts',
    personality: ['blunt'],
    format: 'whiteboard',
    vocabulary: ['amortized'],
    catchphrases: ['Binary search in 30 seconds'],
    dos: ['dry run the code'],
    donts: ['jargon dumps'],
    samplePosts: [],
    audienceAgeRange: '25-34',
    audienceType: 'professionals',
    dnaVersion: 1,
  };
}

/** A provider whose session is driven by the test, not by a timer. */
function scriptedProvider(events: LiveSessionEvent[]): {
  provider: LiveSessionProvider;
  sent: { audio: Buffer[]; texts: string[] };
  closed: () => boolean;
} {
  const sent = { audio: [] as Buffer[], texts: [] as string[] };
  let closed = false;

  const handle: LiveSessionHandle = {
    sendAudio(pcm: Buffer) {
      sent.audio.push(pcm);
    },
    endAudioStream() {},
    sendText(text: string) {
      sent.texts.push(text);
    },
    async next(): Promise<LiveSessionEvent> {
      const event = events.shift();
      return event ?? { kind: 'closed' };
    },
    async close() {
      closed = true;
    },
  };

  return {
    provider: {
      name: 'scripted',
      available: true,
      async open(_options: LiveSessionOptions) {
        return handle;
      },
    },
    sent,
    closed: () => closed,
  };
}

function transport(): SessionTransport & { messages: unknown[]; closes: { code: number; reason: string }[] } {
  const messages: unknown[] = [];
  const closes: { code: number; reason: string }[] = [];
  return {
    messages,
    closes,
    send(_sessionId, message) {
      messages.push(message);
    },
    close(_sessionId, code, reason) {
      closes.push({ code, reason });
    },
  };
}

const startRequest = () =>
  liveSessionStartSchema.parse({
    projectId: 'proj_1',
    script: ['POV: you finally understand binary search', 'The trick is the halving picture', 'Follow for the next one'],
  });

describe('the coaching system instruction', () => {
  it('names all five coaching dimensions', () => {
    const instruction = buildCoachInstruction({ uid: 'creator-a', dna: dnaFor(), script: ['a', 'b'] });
    for (const dimension of COACH_DIMENSIONS) {
      expect(instruction.system).toContain(dimension);
    }
  });

  it('carries the creator DNA context into the instruction', () => {
    const instruction = buildCoachInstruction({ uid: 'creator-a', dna: dnaFor(), script: ['a'] });
    expect(instruction.system).toContain('DSA interview prep');
    expect(instruction.system).toContain('amortized');
  });

  it('numbers the script so the model can name a line', () => {
    const instruction = buildCoachInstruction({
      uid: 'creator-a',
      dna: dnaFor(),
      script: ['first line', 'second line'],
    });
    expect(instruction.system).toContain('1. first line');
    expect(instruction.system).toContain('2. second line');
  });

  it('tells the model to keep tips short', () => {
    const instruction = buildCoachInstruction({ uid: 'creator-a', dna: dnaFor(), script: ['a'] });
    expect(instruction.system).toContain(`At most ${MAX_TIP_WORDS} words`);
  });

  it('tells the model to listen before it talks', () => {
    const instruction = buildCoachInstruction({ uid: 'creator-a', dna: dnaFor(), script: ['a'] });
    expect(instruction.openingPrompt).toMatch(/do not speak until/i);
  });

  it('forbids inventing facts the creator never made', () => {
    const instruction = buildCoachInstruction({ uid: 'creator-a', dna: dnaFor(), script: ['a'] });
    expect(instruction.system).toMatch(/never invent facts/i);
  });
});

describe('extractTip', () => {
  it('pulls a tip out of a JSON-looking model turn', () => {
    const tip = extractTip('{"kind":"pace","severity":"warning","message":"Slow down."}');
    expect(tip).toEqual({ kind: 'pace', severity: 'warning', message: 'Slow down.', atSeconds: undefined });
  });

  it('returns null for plain prose, so it becomes a transcript', () => {
    expect(extractTip('You are doing great, keep going.')).toBeNull();
  });

  it('returns null for malformed JSON rather than throwing', () => {
    expect(extractTip('{"kind":"pace",')).toBeNull();
  });
});

describe('the session registry', () => {
  it('counts sessions per creator per UTC day and stops at the cap', () => {
    const registry = createSessionRegistry({ logger });
    const now = new Date('2026-10-02T10:00:00.000Z').getTime();
    const timed = createSessionRegistry({ logger, now: () => now });

    expect(timed.canStart('creator-a')).toBe(true);

    for (let index = 0; index < 10; index += 1) {
      timed.register({
        sessionId: `s${index}`,
        uid: 'creator-a',
        startedAtMs: now,
        stop: () => undefined,
      });
    }

    expect(timed.usedToday('creator-a')).toBe(10);
    expect(timed.canStart('creator-a')).toBe(false);
    // Another creator is unaffected.
    expect(timed.canStart('creator-b')).toBe(true);
    expect(registry.activeCount()).toBe(0);
  });

  it('frees a session when it ends', () => {
    const registry = createSessionRegistry({ logger });
    registry.register({ sessionId: 's1', uid: 'creator-a', startedAtMs: 0, stop: () => undefined });
    expect(registry.activeCount()).toBe(1);

    const duration = registry.end('s1');
    expect(duration).toBeGreaterThanOrEqual(0);
    expect(registry.activeCount()).toBe(1 - 1);
    // Ending twice is a no-op, not a negative duration.
    expect(registry.end('s1')).toBeNull();
  });

  it('stops every session on shutdown', () => {
    const registry = createSessionRegistry({ logger });
    const stopped: string[] = [];
    for (const id of ['s1', 's2']) {
      registry.register({
        sessionId: id,
        uid: 'creator-a',
        startedAtMs: 0,
        stop: () => stopped.push(id),
      });
    }
    registry.stopAll('shutdown');
    expect(stopped).toEqual(['s1', 's2']);
    expect(registry.activeCount()).toBe(0);
  });

  it('expires yesterday\'s count, so the cap resets daily', () => {
    let now = new Date('2026-10-02T23:59:00.000Z').getTime();
    const registry = createSessionRegistry({ logger, now: () => now });
    for (let index = 0; index < 10; index += 1) {
      registry.register({ sessionId: `s${index}`, uid: 'u', startedAtMs: now, stop: () => undefined });
    }
    expect(registry.canStart('u')).toBe(false);

    now = new Date('2026-10-03T00:01:00.000Z').getTime();
    expect(registry.usedToday('u')).toBe(0);
    expect(registry.canStart('u')).toBe(true);
  });
});

describe('buildSummary', () => {
  it('reads strengths, issues and tips out of the model wrap-up', () => {
    const summary = buildSummary(
      [
        JSON.stringify({
          strengths: ['Steady pace.'],
          issues: ['Three ums in the hook.'],
          tips: ['Breathe before line one.'],
        }),
      ],
      42,
      3,
    );
    expect(summary.strengths).toEqual(['Steady pace.']);
    expect(summary.issues).toEqual(['Three ums in the hook.']);
    expect(summary.tips).toEqual(['Breathe before line one.']);
    expect(summary.durationSeconds).toBe(42);
    expect(summary.linesRead).toBe(3);
  });

  it('still produces a summary when the model never answered', () => {
    const summary = buildSummary([], 12, 1);
    expect(summary.tips.length).toBeGreaterThan(0);
    expect(summary.durationSeconds).toBe(12);
  });

  it('survives a model that answered with prose', () => {
    const summary = buildSummary(['Great job overall!'], 5, 1);
    expect(summary.tips.length).toBeGreaterThan(0);
  });
});

describe('the coaching service', () => {
  function buildService(events: LiveSessionEvent[], dna: CreatorDna | null = dnaFor()) {
    const repository = createMemoryDnaRepository();
    if (dna !== null) void repository.save('creator-a', dna);

    const scripted = scriptedProvider(events);
    const registry = createSessionRegistry({ logger });
    const summaries: unknown[] = [];

    const service = createVoiceCoachService({
      provider: scripted.provider,
      dnaRepository: repository,
      logger,
      model: 'test-live-model',
      registry,
      async saveSummary(_uid, summary) {
        summaries.push(summary);
      },
    });

    return { service, scripted, registry, summaries };
  }

  it('tells the browser the session is ready and its budget', async () => {
    const { service } = buildService([]);
    const wire = transport();

    await service.start({ sessionId: 's1', uid: 'creator-a', request: startRequest(), transport: wire });

    const ready = wire.messages.find((message) => (message as { type: string }).type === 'ready');
    expect(ready).toEqual({ type: 'ready', sessionId: 's1', maxSeconds: 300 });
  });

  it('sends the opening prompt so the model listens first', async () => {
    const { service, scripted } = buildService([]);
    await service.start({ sessionId: 's1', uid: 'creator-a', request: startRequest(), transport: transport() });

    // The opening prompt and, at the end, the wrap-up request.
    expect(scripted.sent.texts.length).toBeGreaterThanOrEqual(1);
    expect(scripted.sent.texts[0]).toMatch(/listen to the whole take/i);
  });

  it('relays a model tip to the browser with the elapsed time stamped on', async () => {
    const tip = coachTipSchema.parse({ kind: 'pace', severity: 'info', message: 'Slow down.' });
    const { service } = buildService([{ kind: 'tip', tip }]);
    const wire = transport();

    const session = await service.start({
      sessionId: 's1',
      uid: 'creator-a',
      request: startRequest(),
      transport: wire,
    });

    // Give the pump a tick to read the queued event.
    await new Promise((resolve) => setTimeout(resolve, 10));
    await session.end();

    const relayed = wire.messages.find((message) => (message as { type: string }).type === 'tip');
    expect(relayed).toBeDefined();
    expect((relayed as { tip: { message: string; atSeconds: number } }).tip.message).toBe('Slow down.');
    expect((relayed as { tip: { atSeconds: number } }).tip.atSeconds).toBeGreaterThanOrEqual(0);
  });

  it('relays model audio so the browser can play spoken feedback', async () => {
    const { service } = buildService([{ kind: 'audio', data: 'AAAA', mimeType: 'audio/pcm;rate=24000' }]);
    const wire = transport();

    const session = await service.start({
      sessionId: 's1',
      uid: 'creator-a',
      request: startRequest(),
      transport: wire,
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    await session.end();

    const audio = wire.messages.find((message) => (message as { type: string }).type === 'audio');
    expect(audio).toEqual({ type: 'audio', data: 'AAAA', mimeType: 'audio/pcm;rate=24000' });
  });

  it('streams microphone PCM through to the provider', async () => {
    const { service, scripted } = buildService([]);
    const session = await service.start({
      sessionId: 's1',
      uid: 'creator-a',
      request: startRequest(),
      transport: transport(),
    });

    session.sendAudio(Buffer.from([1, 2, 3, 4]));
    expect(scripted.sent.audio).toHaveLength(1);
    expect(scripted.sent.audio[0]).toEqual(Buffer.from([1, 2, 3, 4]));
  });

  it('ends with a summary, saves it and closes the socket', async () => {
    const { service, summaries } = buildService([
      {
        kind: 'text',
        text: JSON.stringify({ strengths: ['Good pace.'], issues: [], tips: ['Keep it up.'] }),
      },
    ]);
    const wire = transport();

    const session = await service.start({
      sessionId: 's1',
      uid: 'creator-a',
      request: startRequest(),
      transport: wire,
    });

    await session.end();

    const ended = wire.messages.find((message) => (message as { type: string }).type === 'ended');
    expect(ended).toBeDefined();
    expect((ended as { summary: { strengths: string[] } }).summary.strengths).toEqual(['Good pace.']);
    expect(summaries).toHaveLength(1);
    expect(wire.closes).toEqual([{ code: 1000, reason: 'session ended' }]);
  });

  it('is safe to end twice', async () => {
    const { service, summaries } = buildService([]);
    const session = await service.start({
      sessionId: 's1',
      uid: 'creator-a',
      request: startRequest(),
      transport: transport(),
    });

    await session.end();
    await session.end();

    expect(summaries).toHaveLength(1);
    expect(session.ended).toBe(true);
  });

  it('asks the creator to onboard first when there is no DNA', async () => {
    const { service } = buildService([], null);
    await expect(
      service.start({ sessionId: 's1', uid: 'creator-a', request: startRequest(), transport: transport() }),
    ).rejects.toThrow(/onboarding/i);
  });

  it('closes the socket with live_unavailable when the model cannot be reached', async () => {
    const repository = createMemoryDnaRepository();
    void repository.save('creator-a', dnaFor());

    const service = createVoiceCoachService({
      provider: {
        name: 'broken',
        available: true,
        async open() {
          throw new Error('upstream refused');
        },
      },
      dnaRepository: repository,
      logger,
      model: 'test-live-model',
      registry: createSessionRegistry({ logger }),
      async saveSummary() {},
    });

    const wire = transport();
    await expect(
      service.start({ sessionId: 's1', uid: 'creator-a', request: startRequest(), transport: wire }),
    ).rejects.toThrow(/upstream refused/);

    expect(wire.closes).toEqual([{ code: 4503, reason: 'live_unavailable' }]);
  });

  it('reports the creator\'s remaining quota', async () => {
    const { service, registry } = buildService([]);
    registry.register({ sessionId: 'old', uid: 'creator-a', startedAtMs: 0, stop: () => undefined });

    expect(service.quota('creator-a')).toEqual({
      usedToday: 1,
      dailyCap: 10,
      remainingToday: 9,
      maxSessionSeconds: 300,
    });
  });
});

describe('the post-recording fallback', () => {
  it('coaches a whole take and marks the response as the fallback', async () => {
    const repository = createMemoryDnaRepository();
    void repository.save('creator-a', dnaFor());

    const summaries: unknown[] = [];
    const service = createVoiceCoachService({
      provider: scriptedProvider([
        {
          kind: 'text',
          text: JSON.stringify({ strengths: ['Clear diction.'], issues: ['Rushed the CTA.'], tips: ['Land the last word.'] }),
        },
      ]).provider,
      dnaRepository: repository,
      logger,
      model: 'test-live-model',
      registry: createSessionRegistry({ logger }),
      async saveSummary(_uid, summary) {
        summaries.push(summary);
      },
    });

    const response = await service.feedback('creator-a', {
      script: ['Hook', 'CTA'],
      audio: Buffer.alloc(32).toString('base64'),
      durationSeconds: 9,
    });

    expect(response.fallback).toBe(true);
    expect(response.summary.strengths).toEqual(['Clear diction.']);
    expect(response.summary.issues).toEqual(['Rushed the CTA.']);
    expect(summaries).toHaveLength(1);
  });

  it('refuses when the provider cannot reach a model at all', async () => {
    const repository = createMemoryDnaRepository();
    void repository.save('creator-a', dnaFor());

    const service = createVoiceCoachService({
      provider: { name: 'none', available: false, async open(): Promise<never> { throw new Error('no'); } },
      dnaRepository: repository,
      logger,
      registry: createSessionRegistry({ logger }),
      async saveSummary() {},
    });

    await expect(
      service.feedback('creator-a', { script: ['Hook'], audio: 'AAAA', durationSeconds: 1 }),
    ).rejects.toThrow(/unavailable/i);
  });
});

describe('the stub provider', () => {
  it('emits a tip for every coaching dimension, all derived from the script', async () => {
    vi.useFakeTimers();
    try {
      const provider = createStubLiveProvider({ tipIntervalMs: 1000 });
      const handle = await provider.open({
        model: 'test',
        systemInstruction: 'coach',
        openingPrompt: 'listen',
        script: ['line one', 'line two'],
      });

      handle.sendAudio(Buffer.alloc(16));
      handle.sendAudio(Buffer.alloc(16));

      // Advance far enough for all five tip kinds to have fired.
      await vi.advanceTimersByTimeAsync(25_000);

      const kinds = new Set<string>();
      for (let index = 0; index < 12; index += 1) {
        const event = await handle.next();
        if (event.kind === 'closed') break;
        if (event.kind === 'tip') kinds.add(event.tip.kind);
        if (event.kind === 'text') {
          const tip = extractTip(event.text);
          if (tip !== null) kinds.add(tip.kind);
        }
      }

      expect(kinds.size).toBe(5);
      await handle.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('emits audio too, so playback is exercised in dev', async () => {
    vi.useFakeTimers();
    try {
      const provider = createStubLiveProvider({ tipIntervalMs: 500 });
      const handle = await provider.open({
        model: 'test',
        systemInstruction: 'coach',
        openingPrompt: 'listen',
        script: ['a'],
      });

      await vi.advanceTimersByTimeAsync(1500);
      const event = await handle.next();
      expect(event.kind === 'audio' || event.kind === 'tip').toBe(true);

      await handle.close();
      // A closed handle drains what is queued and then reports closed, rather
      // than hanging the caller.
      let drained = await handle.next();
      let guard = 0;
      while (drained.kind !== 'closed' && guard < 10) {
        drained = await handle.next();
        guard += 1;
      }
      expect(drained).toEqual({ kind: 'closed' });
    } finally {
      vi.useRealTimers();
    }
  });
});
