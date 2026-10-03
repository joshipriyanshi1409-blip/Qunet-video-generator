import { describe, expect, it } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { createServer, type Server } from 'node:http';
import { createUpgradeRouter, pathnameOf, type UpgradeRoute } from '../ws/upgradeRouter.js';
import { testLogger } from './helpers.js';

/**
 * The upgrade router.
 *
 * Two WebSocket paths on one port is the configuration this exists for, and the
 * failure it prevents is invisible to either server's own tests: each one works
 * perfectly well alone, and together they hand out `400` on every handshake
 * because the first to see a request for the other's path destroys the socket.
 */

const logger = testLogger();

interface Fixture {
  port: number;
  close(): Promise<void>;
}

async function startServer(routes: UpgradeRoute[]): Promise<Fixture> {
  const server: Server = createServer((_request, response) => response.writeHead(200).end('ok'));
  createUpgradeRouter({ server, routes, logger });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;

  return {
    port,
    async close() {
      for (const route of routes) route.wss.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** Opens a socket and reports what the handshake did. */
function handshake(
  port: number,
  path: string,
): Promise<{ ok: boolean; message?: string; error?: string }> {
  return new Promise((resolve) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}${path}`);
    socket.on('message', (raw) => {
      resolve({ ok: true, message: raw.toString() });
      socket.close();
    });
    socket.on('error', (error: Error) => resolve({ ok: false, error: error.message }));
    socket.on('close', (code) => {
      if (code !== 1000 && code !== 1005) resolve({ ok: false, error: `closed ${code}` });
    });
  });
}

describe('pathnameOf', () => {
  it('reads the pathname and ignores the query string', () => {
    expect(pathnameOf('/ws/voice-coach?token=abc')).toBe('/ws/voice-coach');
    expect(pathnameOf('/ws')).toBe('/ws');
    expect(pathnameOf(undefined)).toBe('/');
  });

  it('returns null for a URL that cannot be parsed', () => {
    expect(pathnameOf('http://[')).toBeNull();
  });
});

describe('createUpgradeRouter', () => {
  it('routes each path to its own server', async () => {
    const coach = new WebSocketServer({ noServer: true });
    const progress = new WebSocketServer({ noServer: true });
    coach.on('connection', (socket) => socket.send('coach'));
    progress.on('connection', (socket) => socket.send('progress'));

    const fixture = await startServer([
      { path: '/ws', wss: progress },
      { path: '/ws/voice-coach', wss: coach },
    ]);

    try {
      expect(await handshake(fixture.port, '/ws')).toMatchObject({ ok: true, message: 'progress' });
      expect(await handshake(fixture.port, '/ws/voice-coach')).toMatchObject({
        ok: true,
        message: 'coach',
      });
    } finally {
      await fixture.close();
    }
  });

  it('ignores the query string when matching a path', async () => {
    const coach = new WebSocketServer({ noServer: true });
    coach.on('connection', (socket) => socket.send('coach'));

    const fixture = await startServer([{ path: '/ws/voice-coach', wss: coach }]);

    try {
      const result = await handshake(fixture.port, '/ws/voice-coach?dev_uid=creator-a&x=1');
      expect(result).toMatchObject({ ok: true, message: 'coach' });
    } finally {
      await fixture.close();
    }
  });

  it('refuses an unknown path instead of hanging the handshake', async () => {
    const coach = new WebSocketServer({ noServer: true });
    coach.on('connection', (socket) => socket.send('coach'));

    const fixture = await startServer([{ path: '/ws/voice-coach', wss: coach }]);

    try {
      const result = await handshake(fixture.port, '/ws/nope');
      expect(result.ok).toBe(false);
    } finally {
      await fixture.close();
    }
  });

  it('does not treat a path prefix as a match', async () => {
    const coach = new WebSocketServer({ noServer: true });
    coach.on('connection', (socket) => socket.send('coach'));

    const fixture = await startServer([{ path: '/ws', wss: new WebSocketServer({ noServer: true }) }]);

    try {
      // `/ws/voice-coach` must not be swallowed by the `/ws` route.
      const result = await handshake(fixture.port, '/ws/voice-coach');
      expect(result.ok).toBe(false);
    } finally {
      await fixture.close();
    }
  });
});
