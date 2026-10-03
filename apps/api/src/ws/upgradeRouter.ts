import type { Server } from 'node:http';
import type { Duplex } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import type { WebSocketServer } from 'ws';
import type { Logger } from 'pino';

/**
 * One `upgrade` router for every WebSocket path on a port.
 *
 * Needed the moment more than one `WebSocketServer` shares an HTTP server. Two
 * servers both listening on `upgrade` means the first one to see a request for a
 * path it does not own destroys the socket, so the other path answers `400` on
 * every handshake - and nothing in either server's own tests would catch it,
 * because each works perfectly well on its own.
 *
 * The alternative (`noServer: true` on every server plus this router) is also the
 * only way to answer an unknown path with something other than a hang-up.
 */

export interface UpgradeRoute {
  /** Exact pathname this server answers on. */
  readonly path: string;
  readonly wss: WebSocketServer;
}

export interface UpgradeRouterOptions {
  server: Server;
  routes: readonly UpgradeRoute[];
  logger?: Logger;
}

export function createUpgradeRouter(options: UpgradeRouterOptions): void {
  const { server, routes, logger } = options;

  server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const pathname = pathnameOf(request.url);

    if (pathname === null) {
      logger?.debug({ url: request.url }, 'websocket upgrade refused: unparseable url');
      socket.destroy();
      return;
    }

    const route = routes.find((candidate) => candidate.path === pathname);

    if (route === undefined) {
      logger?.debug({ pathname }, 'websocket upgrade refused: unknown path');
      socket.destroy();
      return;
    }

    route.wss.handleUpgrade(request, socket, head, (client) => {
      route.wss.emit('connection', client, request);
    });
  });
}

/** Pathname of an upgrade request, or null when it cannot be parsed. */
export function pathnameOf(url: string | undefined): string | null {
  try {
    return new URL(url ?? '/', 'http://localhost').pathname;
  } catch {
    return null;
  }
}
