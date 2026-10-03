import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { WS_CLOSE_CODES } from '@creatordna/shared';
import { createApp } from '../app.js';
import { createWsServer, type WsServerHandle } from '../ws/index.js';
import type { AuthUser, TokenVerifier } from '../middleware/auth.js';
import { testConfig, testLogger } from './helpers.js';

interface RunningServer {
  port: number;
  close(): Promise<void>;
}

const servers: RunningServer[] = [];

afterAll(async () => {
  await Promise.all(servers.map((server) => server.close()));
  servers.length = 0;
});

async function start(options: {
  devAuthBypass?: boolean;
  verifyToken?: TokenVerifier;
}): Promise<RunningServer> {
  const config = testConfig({
    DEV_AUTH_BYPASS: options.devAuthBypass === true ? 'true' : 'false',
  });
  const logger = testLogger();
  const verifyToken =
    options.verifyToken ??
    (async () => {
      throw new Error('token rejected');
    });

  const app = createApp({ config, logger, redis: null, queues: null, verifyToken });
  const server = createServer(app);
  const ws: WsServerHandle = createWsServer({ server, config, logger, verifyToken });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address() as AddressInfo | null;
  const port = address?.port ?? 0;

  const running: RunningServer = {
    port,
    close: async () => {
      await ws.close();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    },
  };

  servers.push(running);
  return running;
}

function nextMessage(socket: WebSocket, timeoutMs = 3000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for a message')), timeoutMs);
    socket.once('message', (data) => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(data.toString()) as Record<string, unknown>);
      } catch (error) {
        reject(error);
      }
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function nextClose(socket: WebSocket, timeoutMs = 3000): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for close')), timeoutMs);
    socket.once('close', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

function connect(port: number, query = ''): WebSocket {
  return new WebSocket(`ws://127.0.0.1:${port}/ws${query}`);
}

describe('ws server', () => {
  it('closes the connection when no token is supplied', async () => {
    const server = await start({});
    const socket = connect(server.port);

    const code = await nextClose(socket);
    expect(code).toBe(WS_CLOSE_CODES.unauthorized);
  });

  it('closes the connection when the token is rejected', async () => {
    const server = await start({});
    const socket = connect(server.port, '?token=bad-token');

    const code = await nextClose(socket);
    expect(code).toBe(WS_CLOSE_CODES.unauthorized);
  });

  it('greets an authenticated client and answers ping with pong', async () => {
    const user: AuthUser = {
      uid: 'uid-from-token',
      email: 'creator@example.com',
      emailVerified: true,
      claims: {},
    };
    const verifyToken: TokenVerifier = async (token) => {
      if (token !== 'good-token') throw new Error('bad token');
      return user;
    };

    const server = await start({ verifyToken });
    const socket = connect(server.port, '?token=good-token');

    const hello = await nextMessage(socket);
    expect(hello.type).toBe('hello');
    expect(hello.uid).toBe('uid-from-token');

    socket.send(JSON.stringify({ type: 'ping' }));
    const pong = await nextMessage(socket);
    expect(pong.type).toBe('pong');
    expect(typeof pong.at).toBe('string');

    socket.close();
  });

  it('accepts ?dev_uid= only when the dev bypass is enabled', async () => {
    const bypassServer = await start({ devAuthBypass: true });
    const socket = connect(bypassServer.port, '?dev_uid=local-creator');

    const hello = await nextMessage(socket);
    expect(hello.uid).toBe('local-creator');
    expect(hello.devBypass).toBe(true);
    socket.close();

    const strictServer = await start({ devAuthBypass: false });
    const rejected = connect(strictServer.port, '?dev_uid=local-creator');
    expect(await nextClose(rejected)).toBe(WS_CLOSE_CODES.unauthorized);
  });

  it('replies with an error event for malformed JSON', async () => {
    const verifyToken: TokenVerifier = async () => ({
      uid: 'uid-from-token',
      emailVerified: true,
      claims: {},
    });
    const server = await start({ verifyToken });
    const socket = connect(server.port, '?token=good-token');

    await nextMessage(socket); // hello
    socket.send('this is not json');

    const error = await nextMessage(socket);
    expect(error.type).toBe('error');
    expect((error.error as { code: string }).code).toBe('invalid_json');

    socket.close();
  });

  it('acknowledges channel subscriptions', async () => {
    const verifyToken: TokenVerifier = async () => ({
      uid: 'uid-from-token',
      emailVerified: true,
      claims: {},
    });
    const server = await start({ verifyToken });
    const socket = connect(server.port, '?token=good-token');

    await nextMessage(socket); // hello
    socket.send(JSON.stringify({ type: 'subscribe', channel: 'job:1' }));

    const ack = await nextMessage(socket);
    expect(ack).toMatchObject({ type: 'subscribe', channel: 'job:1' });

    socket.close();
  });
});
