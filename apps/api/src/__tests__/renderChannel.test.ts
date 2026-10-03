import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createApp } from '../app.js';
import { createWsServer, renderChannel, type WsServerHandle } from '../ws/index.js';
import type { AuthUser, TokenVerifier } from '../middleware/auth.js';
import { testConfig, testLogger } from './helpers.js';

/**
 * The render progress channel.
 *
 * A browser subscribes to one render by job id and gets stage + progress events
 * for it. The interesting part is not the plumbing - it is that a socket may
 * only follow its *own* render, which is checked against the job document rather
 * than taken on trust from the channel name.
 */

interface RunningServer {
  port: number;
  handle: WsServerHandle;
  close(): Promise<void>;
}

const servers: RunningServer[] = [];

afterAll(async () => {
  await Promise.all(servers.map((server) => server.close()));
  servers.length = 0;
});

const creator: AuthUser = {
  uid: 'uid-owner',
  email: 'creator@example.com',
  emailVerified: true,
  claims: {},
};

const verifyToken: TokenVerifier = async (token) => {
  if (token !== 'good-token') throw new Error('bad token');
  return creator;
};

/** Starts a server whose job ownership map is `owners` (jobId -> uid). */
async function start(owners: Record<string, string>): Promise<RunningServer> {
  const config = testConfig();
  const logger = testLogger();
  const app = createApp({ config, logger, redis: null, queues: null, verifyToken });
  const server = createServer(app);
  const handle = createWsServer({
    server,
    config,
    logger,
    verifyToken,
    renderJobOwner: async (jobId) => owners[jobId] ?? null,
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address() as AddressInfo | null;
  const running: RunningServer = {
    port: address?.port ?? 0,
    handle,
    close: async () => {
      await handle.close();
      await new Promise<void>((resolve) => {
        for (const client of handle.wss.clients) client.terminate();
        server.close(() => resolve());
      });
    },
  };

  servers.push(running);
  return running;
}

function connect(port: number): WebSocket {
  return new WebSocket(`ws://127.0.0.1:${port}/ws?token=good-token`);
}

/** Buffers every message from the moment the socket opens. */
function collector(socket: WebSocket): { messages: Record<string, unknown>[] } {
  const messages: Record<string, unknown>[] = [];
  socket.on('message', (data) => {
    messages.push(JSON.parse(data.toString()) as Record<string, unknown>);
  });
  return { messages };
}

function waitFor(
  messages: Record<string, unknown>[],
  predicate: (message: Record<string, unknown>) => boolean,
  timeoutMs = 3000,
): Promise<Record<string, unknown>> {
  const found = messages.find(predicate);
  if (found !== undefined) return Promise.resolve(found);

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for a message')), timeoutMs);
    const check = (): void => {
      const match = messages.find(predicate);
      if (match !== undefined) {
        clearTimeout(timer);
        clearInterval(interval);
        resolve(match);
      }
    };
    const interval = setInterval(check, 20);
    void interval.unref?.();
  });
}

const opened = (socket: WebSocket): Promise<void> =>
  new Promise((resolve, reject) => {
    if (socket.readyState === WebSocket.OPEN) {
      resolve();
      return;
    }
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });

describe('the render progress channel', () => {
  it('names a channel per job', () => {
    expect(renderChannel('job_42')).toBe('render:job_42');
    expect(renderChannel('job_42')).not.toBe(renderChannel('job_43'));
  });

  it('acknowledges a subscription to the caller\'s own render', async () => {
    const server = await start({ job_1: 'uid-owner' });
    const socket = connect(server.port);
    const buffer = await collect(socket);

    socket.send(JSON.stringify({ type: 'subscribe', channel: renderChannel('job_1') }));

    const ack = await waitFor(buffer.messages, (message) => message.type === 'subscribe');
    expect(ack.channel).toBe('render:job_1');

    socket.close();
  });

  it('delivers stage and progress events to the subscriber', async () => {
    const server = await start({ job_1: 'uid-owner' });
    const socket = connect(server.port);
    const buffer = await collect(socket);

    socket.send(JSON.stringify({ type: 'subscribe', channel: renderChannel('job_1') }));
    await waitFor(buffer.messages, (message) => message.type === 'subscribe');

    server.handle.broadcast(renderChannel('job_1'), {
      type: 'render.progress',
      jobId: 'job_1',
      stage: 'assets',
      progress: 40,
      message: 'rendering scene 2 of 5',
    });

    const event = await waitFor(buffer.messages, (message) => message.type === 'render.progress');
    expect(event).toMatchObject({
      jobId: 'job_1',
      stage: 'assets',
      progress: 40,
      message: 'rendering scene 2 of 5',
    });

    socket.close();
  });

  it('does not deliver one render\'s events to a socket watching another', async () => {
    const server = await start({ job_1: 'uid-owner', job_2: 'uid-owner' });
    const socket = connect(server.port);
    const buffer = await collect(socket);

    socket.send(JSON.stringify({ type: 'subscribe', channel: renderChannel('job_1') }));
    await waitFor(buffer.messages, (message) => message.type === 'subscribe');

    server.handle.broadcast(renderChannel('job_2'), {
      type: 'render.progress',
      jobId: 'job_2',
      stage: 'voice',
      progress: 60,
    });

    // The other render must stay invisible: a progress bar for somebody else's
    // job is worse than no progress bar at all.
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(buffer.messages.filter((message) => message.type === 'render.progress')).toEqual([]);

    socket.close();
  });

  it('refuses a subscription to another creator\'s render', async () => {
    // The job exists, but it belongs to someone else.
    const server = await start({ job_1: 'uid-somebody-else' });
    const socket = connect(server.port);
    const buffer = await collect(socket);

    socket.send(JSON.stringify({ type: 'subscribe', channel: renderChannel('job_1') }));

    const error = await waitFor(buffer.messages, (message) => message.type === 'error');
    expect((error.error as { code: string }).code).toBe('forbidden');
    expect(buffer.messages.some((message) => message.type === 'subscribe')).toBe(false);

    // And no progress from that job reaches the socket afterwards.
    server.handle.broadcast(renderChannel('job_1'), {
      type: 'render.progress',
      jobId: 'job_1',
      stage: 'voice',
      progress: 60,
    });
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(buffer.messages.filter((message) => message.type === 'render.progress')).toEqual([]);

    socket.close();
  });

  it('refuses a subscription to a job that does not exist', async () => {
    const server = await start({});
    const socket = connect(server.port);
    const buffer = await collect(socket);

    socket.send(JSON.stringify({ type: 'subscribe', channel: renderChannel('job_ghost') }));

    const error = await waitFor(buffer.messages, (message) => message.type === 'error');
    expect((error.error as { code: string }).code).toBe('forbidden');

    socket.close();
  });

  it('refuses a subscription when no ownership lookup is wired', async () => {
    // No `renderJobOwner` means the deployment cannot answer the question, and
    // the safe answer is "no" rather than "yes".
    const config = testConfig();
    const logger = testLogger();
    const app = createApp({ config, logger, redis: null, queues: null, verifyToken });
    const server = createServer(app);
    const handle = createWsServer({ server, config, logger, verifyToken });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    servers.push({
      port: (server.address() as AddressInfo).port,
      handle,
      close: async () => {
        await handle.close();
        await new Promise<void>((resolve) => {
          for (const client of handle.wss.clients) client.terminate();
          server.close(() => resolve());
        });
      },
    });

    const socket = connect((server.address() as AddressInfo).port);
    const buffer = await collect(socket);

    socket.send(JSON.stringify({ type: 'subscribe', channel: renderChannel('job_1') }));

    const error = await waitFor(buffer.messages, (message) => message.type === 'error');
    expect((error.error as { code: string }).code).toBe('forbidden');

    socket.close();
  });

  it('still acknowledges a plain channel that is not a render', async () => {
    // The ownership check must not break ordinary channel subscriptions.
    const server = await start({ job_1: 'uid-owner' });
    const socket = connect(server.port);
    const buffer = await collect(socket);

    socket.send(JSON.stringify({ type: 'subscribe', channel: 'job:1' }));
    const ack = await waitFor(buffer.messages, (message) => message.type === 'subscribe');
    expect(ack.channel).toBe('job:1');

    socket.close();
  });

  it('stops delivering events after an unsubscribe', async () => {
    const server = await start({ job_1: 'uid-owner' });
    const socket = connect(server.port);
    const buffer = await collect(socket);

    socket.send(JSON.stringify({ type: 'subscribe', channel: renderChannel('job_1') }));
    await waitFor(buffer.messages, (message) => message.type === 'subscribe');

    socket.send(JSON.stringify({ type: 'unsubscribe', channel: renderChannel('job_1') }));
    await waitFor(buffer.messages, (message) => message.type === 'unsubscribe');

    server.handle.broadcast(renderChannel('job_1'), {
      type: 'render.progress',
      jobId: 'job_1',
      stage: 'voice',
      progress: 60,
    });

    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(buffer.messages.filter((message) => message.type === 'render.progress')).toEqual([]);

    socket.close();
  });

  it('rejects a subscription with an empty channel', async () => {
    const server = await start({ job_1: 'uid-owner' });
    const socket = connect(server.port);
    const buffer = await collect(socket);

    socket.send(JSON.stringify({ type: 'subscribe', channel: '' }));

    const error = await waitFor(buffer.messages, (message) => message.type === 'error');
    expect((error.error as { code: string }).code).toBe('invalid_channel');

    socket.close();
  });
});

/** Opens a socket and buffers every message it receives from then on. */
async function collect(socket: WebSocket): Promise<{ messages: Record<string, unknown>[] }> {
  await opened(socket);
  const buffer = collector(socket);
  // The `hello` the server sends on connect must already be in the buffer by the
  // time anything else is asserted, so yield once.
  await new Promise((resolve) => setTimeout(resolve, 30));
  return buffer;
}

