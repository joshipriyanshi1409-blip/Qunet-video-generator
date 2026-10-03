import type { Server } from 'node:http';
import { WebSocketServer } from 'ws';
import type { RawData, WebSocket } from 'ws';
import { WS_CLOSE_CODES, WS_EVENTS } from '@creatordna/shared';
import type { Logger } from 'pino';
import type { AppConfig } from '../config/index.js';
import type { TokenVerifier } from '../middleware/auth.js';

export interface WsServerOptions {
  server: Server;
  config: AppConfig;
  logger: Logger;
  verifyToken: TokenVerifier;
  path?: string;
  /**
   * Take the server off the shared HTTP `upgrade` event and let the caller route
   * upgrades instead. Required as soon as more than one WebSocket path shares a
   * port: two `WebSocketServer`s both listening on `upgrade` means the first one
   * to see a request for a path it does not own destroys the socket.
   */
  noServer?: boolean;
  /**
   * Resolves the creator a render job belongs to, so a socket may only subscribe
   * to its own renders. Omit to refuse every render subscription.
   */
  renderJobOwner?(jobId: string): Promise<string | null>;
}

export interface WsServerHandle {
  wss: WebSocketServer;
  /** The path this server answers on, for the caller's upgrade router. */
  readonly wsPath: string;
  /** Sends a message to every socket subscribed to `channel`. */
  broadcast(channel: string, message: unknown): void;
  close(): Promise<void>;
}

interface ClientState {
  uid: string;
  channels: Set<string>;
}

/** Channel prefix for live render progress. One job, one channel. */
export const RENDER_CHANNEL_PREFIX = 'render:';

/** The channel a browser subscribes to in order to follow one render. */
export function renderChannel(jobId: string): string {
  return `${RENDER_CHANNEL_PREFIX}${jobId}`;
}

/**
 * WebSocket server mounted on the same HTTP server as the REST API.
 *
 * Auth happens on connect (engineering rule 4): the Firebase ID token is passed
 * as `?token=<idToken>` (browsers cannot set headers on a WebSocket handshake).
 * When `DEV_AUTH_BYPASS=true` the `?dev_uid=` query parameter is accepted instead.
 */
export function createWsServer(options: WsServerOptions): WsServerHandle {
  const { server, config, logger, verifyToken, path = '/ws', renderJobOwner } = options;
  const clients = new Map<WebSocket, ClientState>();

  const wss = new WebSocketServer(
    options.noServer === true
      ? { noServer: true, maxPayload: 64 * 1024 }
      : { server, path, maxPayload: 64 * 1024 },
  );

  function send(socket: WebSocket, message: unknown): void {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }

  function tokenFromRequest(url: string | undefined): { token: string | null; devUid: string | null } {
    try {
      const parsed = new URL(url ?? '/', 'http://localhost');
      return {
        token: parsed.searchParams.get('token'),
        devUid: parsed.searchParams.get('dev_uid'),
      };
    } catch {
      return { token: null, devUid: null };
    }
  }

  wss.on('connection', (socket: WebSocket, request) => {
    const { token, devUid } = tokenFromRequest(request.url);

    void (async () => {
      if (config.env.DEV_AUTH_BYPASS && devUid !== null && devUid.trim().length > 0) {
        const state: ClientState = { uid: devUid.trim().slice(0, 128), channels: new Set() };
        clients.set(socket, state);
        logger.debug({ uid: state.uid }, 'ws client connected (dev bypass)');
        send(socket, {
          type: WS_EVENTS.hello,
          at: new Date().toISOString(),
          uid: state.uid,
          devBypass: true,
        });
        return;
      }

      if (token === null) {
        logger.debug('ws connection rejected: missing token');
        socket.close(WS_CLOSE_CODES.unauthorized, 'missing token');
        return;
      }

      try {
        const user = await verifyToken(token);
        const state: ClientState = { uid: user.uid, channels: new Set() };
        clients.set(socket, state);
        logger.debug({ uid: user.uid }, 'ws client connected');
        send(socket, {
          type: WS_EVENTS.hello,
          at: new Date().toISOString(),
          uid: user.uid,
          devBypass: false,
        });
      } catch (error) {
        logger.debug({ err: error }, 'ws connection rejected: invalid token');
        socket.close(WS_CLOSE_CODES.unauthorized, 'invalid token');
      }
    })();

    socket.on('message', (data: RawData) => {
      void (async () => {
      const state = clients.get(socket);
      if (state === undefined) return;

      let parsed: unknown;
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        send(socket, {
          type: WS_EVENTS.error,
          error: { code: 'invalid_json', message: 'Messages must be JSON objects.' },
        });
        return;
      }

      if (typeof parsed !== 'object' || parsed === null) {
        send(socket, {
          type: WS_EVENTS.error,
          error: { code: 'invalid_message', message: 'Messages must be JSON objects.' },
        });
        return;
      }

      const message = parsed as { type?: unknown; channel?: unknown; jobId?: unknown };

      switch (message.type) {
        case WS_EVENTS.ping:
          send(socket, { type: WS_EVENTS.pong, at: new Date().toISOString() });
          break;
        case WS_EVENTS.subscribe:
        case WS_EVENTS.unsubscribe:
        case WS_EVENTS.renderSubscribe:
        case WS_EVENTS.renderUnsubscribe: {
          const subscribing =
            message.type === WS_EVENTS.subscribe || message.type === WS_EVENTS.renderSubscribe;
          // Two spellings of the same intent: the generic `{channel}` form, and
          // `{jobId}` for a render, so the browser never has to know that a
          // render channel is `render:<jobId>`.
          const explicitJobId =
            message.type === WS_EVENTS.renderSubscribe ||
            message.type === WS_EVENTS.renderUnsubscribe
              ? (typeof message.jobId === 'string' ? message.jobId : '')
              : null;
          const channel =
            explicitJobId !== null
              ? explicitJobId.length > 0
                ? renderChannel(explicitJobId)
                : ''
              : typeof message.channel === 'string'
                ? message.channel
                : '';

          if (channel.length === 0) {
            send(socket, {
              type: WS_EVENTS.error,
              error: { code: 'invalid_channel', message: 'subscribe requires a "channel" string.' },
            });
            break;
          }

          // A render channel is `render:<jobId>`, and it is the one subscription
          // that must be refused when it is not the caller's own job - so it is
          // checked against the job document rather than trusted from the client.
          if (channel.startsWith(RENDER_CHANNEL_PREFIX)) {
            const jobId = channel.slice(RENDER_CHANNEL_PREFIX.length);
            const owner = renderJobOwner === undefined ? null : await renderJobOwner(jobId);

            if (owner === null || owner !== state.uid) {
              logger.debug({ uid: state.uid, jobId }, 'render channel refused: not the owner');
              send(socket, {
                type: WS_EVENTS.error,
                error: { code: 'forbidden', message: 'You can only follow your own renders.' },
              });
              break;
            }
          }

          if (subscribing) state.channels.add(channel);
          else state.channels.delete(channel);

          // Acknowledge in the same shape the caller used, so a client that sent
          // `render.subscribe` is not handed a `subscribe` it has to decode.
          const ackType =
            explicitJobId !== null
              ? subscribing
                ? WS_EVENTS.renderSubscribe
                : WS_EVENTS.renderUnsubscribe
              : (message.type as string);
          send(socket, { type: ackType, channel, jobId: explicitJobId ?? undefined });
          break;
        }
        default:
          send(socket, {
            type: WS_EVENTS.error,
            error: { code: 'unknown_message_type', message: `Unknown message type "${String(message.type)}".` },
          });
      }
      })();
    });

    socket.on('close', () => {
      clients.delete(socket);
    });

    socket.on('error', (error: Error) => {
      logger.debug({ err: error }, 'ws socket error');
      clients.delete(socket);
    });
  });

  return {
    wss,
    /** The path this server answers on, for the caller's upgrade router. */
    wsPath: path,
    broadcast(channel, message) {
      const payload = JSON.stringify(message);
      for (const [socket, state] of clients) {
        if (state.channels.has(channel) && socket.readyState === socket.OPEN) {
          socket.send(payload);
        }
      }
    },
    async close() {
      for (const socket of clients.keys()) {
        socket.close(1001, 'server shutting down');
      }
      clients.clear();
      await new Promise<void>((resolve) => {
        wss.close(() => resolve());
      });
    },
  };
}
