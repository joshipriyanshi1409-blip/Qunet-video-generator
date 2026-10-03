import { describe, expect, it } from 'vitest';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer, type Server } from 'node:http';
import { coachTipSchema } from '@creatordna/shared';
import type { CreatorDna } from '@creatordna/shared';
import type { DnaRepository } from '../lib/dnaRepository.js';
import { createSessionRegistry } from '../voiceCoach/registry.js';
import { createVoiceCoachService } from '../voiceCoach/service.js';
import { createVoiceCoachSocketHandler } from '../voiceCoach/wsHandler.js';
import type { LiveSessionEvent, LiveSessionProvider } from '../voiceCoach/types.js';
import { testLogger } from './helpers.js';

/**
 * The coaching socket, end to end.
 *
 * A real HTTP server, a real WebSocket handshake, a real token check - because
 * the parts that matter here are exactly the ones a unit test would fake away:
 * that auth happens on connect, that a bad token never reaches the model, and
 * that a dropped socket frees the model session.
 */

const logger = testLogger();

function dnaFor(): CreatorDna {
  return {
    niche: 'DSA interview prep for career switchers',
    tone: ['direct', 'playful'],
    audience: ['Career switchers', 'Students'],
    style: 'Short sentences, whiteboard, fast cuts',
    personality: ['blunt'],
    format: 'whiteboard',
    vocabulary: ['amortized'],
    catchphrases: [],
    dos: [],
    donts: [],
    samplePosts: [],
    audienceAgeRange: '25-34',
    audienceType: 'professionals',
    dnaVersion: 1,
  };
}

function memoryDnaRepository(): DnaRepository {
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

/**
 * A provider whose events the test pushes into, so timing is deterministic.
 *
 * `next()` blocks until an event is pushed, which is what a real Live session
 * does while the creator is thinking. Tests that end a session push `closed` to
 * release the wrap-up wait instead of sitting out the fifteen-second timeout.
 */
function controllableProvider(): {
  provider: LiveSessionProvider;
  push(event: LiveSessionEvent): void;
  /** Ends every read on every open handle, the way a dropped socket does. */
  release(): void;
  readonly audioChunks: number;
  readonly texts: string[];
  readonly closes: number;
} {
  const waiters: (() => void)[] = [];
  const queue: LiveSessionEvent[] = [];
  const state = { audioChunks: 0, texts: [] as string[], closes: 0 };
  let released = false;

  function wake(): void {
    const resolve = waiters.shift();
    resolve?.();
  }

  return {
    get audioChunks() {
      return state.audioChunks;
    },
    texts: state.texts,
    get closes() {
      return state.closes;
    },
    release() {
      released = true;
      while (waiters.length > 0) wake();
    },
    provider: {
      name: 'controllable',
      available: true,
      async open() {
        let handleClosed = false;

        return {
          sendAudio() {
            state.audioChunks += 1;
          },
          endAudioStream() {},
          sendText(text: string) {
            state.texts.push(text);
          },
          async next(): Promise<LiveSessionEvent> {
            for (;;) {
              const event = queue.shift();
              if (event !== undefined) return event;
              // A handle that has been closed, or a provider released by the
              // harness, answers `closed` from now on. Without this the service's
              // pump loop waits forever and the harness never shuts down.
              if (handleClosed || released) return { kind: 'closed' };
              await new Promise<void>((resolve) => waiters.push(resolve));
            }
          },
          async close() {
            handleClosed = true;
            state.closes += 1;
            wake();
          },
        };
      },
    },
    push(event: LiveSessionEvent) {
      queue.push(event);
      wake();
    },
  };
}

interface Harness {
  port: number;
  provider: ReturnType<typeof controllableProvider>;
  summaries: unknown[];
  registry: ReturnType<typeof createSessionRegistry>;
  close(): Promise<void>;
}

/** Boots a server with the coaching socket mounted on `/ws/voice-coach`. */
async function startHarness(options: {
  verifyToken?(token: string): Promise<{ uid: string }>;
  devAuthBypass?: boolean;
  dna?: CreatorDna | null;
  registry?: ReturnType<typeof createSessionRegistry>;
}): Promise<Harness> {
  const repository = memoryDnaRepository();
  if (options.dna !== null) void repository.save('creator-a', options.dna ?? dnaFor());

  const provider = controllableProvider();
  const summaries: unknown[] = [];
  const registry = options.registry ?? createSessionRegistry({ logger });

  const service = createVoiceCoachService({
    provider: provider.provider,
    dnaRepository: repository,
    logger,
    model: 'test-live-model',
    registry,
    async saveSummary(_uid, summary) {
      summaries.push(summary);
    },
  });

  const handler = createVoiceCoachSocketHandler({
    logger,
    verifyToken: options.verifyToken ?? (async () => ({ uid: 'creator-a' })),
    devAuthBypass: options.devAuthBypass ?? true,
    service,
    registry,
  });

  const server: Server = createServer((_request, response) => {
    response.writeHead(200).end('ok');
  });
  const wss = new WebSocketServer({ server, path: '/ws/voice-coach' });
  wss.on('connection', (socket, request) => {
    void handler.connection(socket, request);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;

  return {
    port,
    provider,
    summaries,
    registry,
    async close() {
      // Release any pending model read first, so a session that never said
      // `end` still wraps up immediately instead of sitting out the timeout.
      provider.release();
      await handler.shutdown();
      // Terminating matters: `wss.close()` only stops new connections, and
      // `server.close()` then waits on a socket that is still open.
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/**
 * Buffers a socket's messages as they arrive.
 *
 * The buffer has to be attached in `connect()`, not on the first `read()`: the
 * server answers the session start before the test asks for anything, and a
 * listener attached afterwards would miss a message that already fired.
 */
const inboxes = new WeakMap<WebSocket, { next(): Promise<Record<string, unknown>> }>();

function inbox(socket: WebSocket): { next(): Promise<Record<string, unknown>> } {
  const existing = inboxes.get(socket);
  if (existing !== undefined) return existing;

  const queue: Record<string, unknown>[] = [];
  const waiters: (() => void)[] = [];
  let failure: Error | null = null;

  socket.on('message', (raw) => {
    queue.push(JSON.parse(raw.toString()) as Record<string, unknown>);
    waiters.shift()?.();
  });
  socket.on('close', () => {
    failure = new Error('socket closed');
    waiters.shift()?.();
  });

  const created = {
    async next(): Promise<Record<string, unknown>> {
      for (;;) {
        const message = queue.shift();
        if (message !== undefined) return message;
        if (failure !== null) throw failure;
        await new Promise<void>((resolve) => waiters.push(resolve));
      }
    },
  };

  inboxes.set(socket, created);
  return created;
}

/** Connects, and resolves once the socket is open. */
function connect(port: number, query = 'dev_uid=creator-a'): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws/voice-coach?${query}`);
    inbox(socket);
    socket.on('open', () => resolve(socket));
    socket.on('error', reject);
  });
}

/** Reads the next JSON message from a socket. */
function read(socket: WebSocket): Promise<Record<string, unknown>> {
  return inbox(socket).next();
}

/**
 * Reads until a message of `type` arrives, returning it.
 *
 * Ending a session relays the model's wrap-up text as a transcript first, so a
 * test that wants `ended` has to be willing to skip past it.
 */
async function readUntil(socket: WebSocket, type: string): Promise<Record<string, unknown>> {
  for (;;) {
    const message = await read(socket);
    if (message['type'] === type) return message;
  }
}

/** Waits for the socket to close, resolving with its code. */
function closed(socket: WebSocket): Promise<number> {
  return new Promise((resolve) => {
    socket.on('close', (code) => resolve(code));
  });
}

/** Polls until `check` is true, so a test never races the handler. */
async function waitFor(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (check()) return;
    if (Date.now() > deadline) throw new Error('condition never became true');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const startMessage = {
  type: 'start',
  script: ['POV: you finally understand binary search', 'The trick is the halving picture'],
  projectId: 'proj_1',
};

describe('the coaching socket', () => {
  it('sends ready with the session budget once the session starts', async () => {
    const harness = await startHarness({});
    try {
      const socket = await connect(harness.port);
      socket.send(JSON.stringify(startMessage));

      const message = await read(socket);
      expect(message).toMatchObject({ type: 'ready', maxSeconds: 300 });
      expect(typeof message['sessionId']).toBe('string');

      socket.close();
    } finally {
      await harness.close();
    }
  });

  it('relays a model tip to the browser', async () => {
    const harness = await startHarness({});
    try {
      const socket = await connect(harness.port);
      socket.send(JSON.stringify(startMessage));
      await read(socket);

      const tip = coachTipSchema.parse({
        kind: 'filler',
        severity: 'warning',
        message: 'Two ums on line one.',
      });
      harness.provider.push({ kind: 'tip', tip });

      const message = await read(socket);
      expect(message).toMatchObject({ type: 'tip' });
      expect((message['tip'] as { message: string }).message).toBe('Two ums on line one.');

      socket.close();
    } finally {
      await harness.close();
    }
  });

  it('streams microphone PCM through to the provider', async () => {
    const harness = await startHarness({});
    try {
      const socket = await connect(harness.port);
      socket.send(JSON.stringify(startMessage));
      await read(socket);

      const chunk = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]).toString('base64');
      socket.send(JSON.stringify({ type: 'audio', data: chunk }));
      socket.send(JSON.stringify({ type: 'line', index: 1 }));

      await waitFor(() => harness.provider.audioChunks === 1);

      socket.close();
    } finally {
      await harness.close();
    }
  });

  it('rejects a connection with no token', async () => {
    const harness = await startHarness({ devAuthBypass: false });
    try {
      const socket = await connect(harness.port, '');
      expect(await closed(socket)).toBe(4401);
    } finally {
      await harness.close();
    }
  });

  it('rejects a connection whose token does not verify', async () => {
    const harness = await startHarness({
      devAuthBypass: false,
      verifyToken: async () => {
        throw new Error('bad token');
      },
    });
    try {
      const socket = await connect(harness.port, 'token=nope');
      expect(await closed(socket)).toBe(4401);
    } finally {
      await harness.close();
    }
  });

  it('rejects a first message that is not a session start', async () => {
    const harness = await startHarness({});
    try {
      const socket = await connect(harness.port);
      socket.send(JSON.stringify({ type: 'audio', data: 'AAAA' }));
      expect(await closed(socket)).toBe(4400);
    } finally {
      await harness.close();
    }
  });

  it('rejects an unrecognised message type without dropping the session', async () => {
    const harness = await startHarness({});
    try {
      const socket = await connect(harness.port);
      socket.send(JSON.stringify(startMessage));
      await read(socket);

      socket.send(JSON.stringify({ type: 'teleport' }));
      const message = await read(socket);
      expect(message).toMatchObject({ type: 'error', error: { code: 'invalid_message' } });

      socket.close();
    } finally {
      await harness.close();
    }
  });

  it('ends the session and saves a summary when the client says end', async () => {
    const harness = await startHarness({});
    try {
      const socket = await connect(harness.port);
      socket.send(JSON.stringify(startMessage));
      await read(socket);

      socket.send(JSON.stringify({ type: 'end' }));

      // The wrap-up turn: the service asks the model, which answers here.
      harness.provider.push({
        kind: 'text',
        text: JSON.stringify({ strengths: ['Good pace.'], issues: [], tips: ['Keep going.'] }),
      });

      const message = await readUntil(socket, 'ended');
      expect(message).toMatchObject({ type: 'ended' });
      expect((message['summary'] as { strengths: string[] }).strengths).toEqual(['Good pace.']);

      await waitFor(() => harness.summaries.length === 1);

      socket.close();
    } finally {
      await harness.close();
    }
  });

  it('frees the model session when the browser drops without saying end', async () => {
    const harness = await startHarness({});
    try {
      const socket = await connect(harness.port);
      socket.send(JSON.stringify(startMessage));
      await read(socket);

      // Abrupt close: no `end` message. Releasing the provider answers the
      // wrap-up wait with `closed` so the test does not sit out the timeout.
      socket.terminate();
      harness.provider.release();

      await waitFor(() => harness.provider.closes === 1);
      expect(harness.summaries).toHaveLength(1);
    } finally {
      await harness.close();
    }
  });

  it('stops at the daily cap before opening a socket', async () => {
    const registry = createSessionRegistry({ logger });
    const harness = await startHarness({ registry });
    try {
      // Burn the cap by starting and ending ten sessions through the socket.
      for (let index = 0; index < 10; index += 1) {
        const socket = await connect(harness.port);
        socket.send(JSON.stringify(startMessage));
        await read(socket);

        socket.send(JSON.stringify({ type: 'end' }));

        // The wrap-up answer, sent after the request so the pump relays it.
        harness.provider.push({
          kind: 'text',
          text: JSON.stringify({ strengths: [], issues: [], tips: ['Tight.'] }),
        });

        await readUntil(socket, 'ended');
        socket.close();
      }

      await waitFor(() => harness.registry.usedToday('creator-a') === 10);

      // The eleventh connection is refused with the quota close code.
      const socket = await connect(harness.port);
      expect(await closed(socket)).toBe(4029);
    } finally {
      await harness.close();
    }
  });
});
