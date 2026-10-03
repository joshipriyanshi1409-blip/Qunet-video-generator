import { randomUUID } from 'node:crypto';
import {
  liveClientMessageSchema,
  liveSessionStartSchema,
  type LiveServerMessage,
} from '@creatordna/shared';
import type { RawData, WebSocket } from 'ws';
import type { Logger } from 'pino';
import { createSessionRegistry, type SessionRegistry } from './registry.js';
import type { RunningSession, VoiceCoachService } from './service.js';

/**
 * The browser-facing coaching socket.
 *
 * Mounted on a dedicated path (`/ws/voice-coach`) rather than the general `/ws`
 * endpoint, so the coach is a genuinely isolated module: a coaching socket can
 * never disturb the job-progress channel, and the general endpoint never has to
 * know audio exists.
 *
 * Auth is the same rule as everywhere else (engineering rule 4): the Firebase ID
 * token is verified on connect, from `?token=`, with the dev bypass accepted only
 * when `DEV_AUTH_BYPASS=true`.
 */

export interface VoiceCoachSocketOptions {
  logger: Logger;
  /** Verifies the Firebase ID token from the handshake. */
  verifyToken(token: string): Promise<{ uid: string }>;
  /** True when `?dev_uid=` may stand in for a token. */
  devAuthBypass: boolean;
  service: VoiceCoachService;
  registry?: SessionRegistry;
}

export interface VoiceCoachSocketHandle {
  /** Handles one upgraded connection. */
  connection(socket: WebSocket, request: { url?: string }): Promise<void>;
  /** Ends every live session - used on shutdown. */
  shutdown(): Promise<void>;
}

/** Bytes of PCM the browser may send in one frame. ~4s at 16 kHz 16-bit mono. */
const MAX_AUDIO_FRAME_BYTES = 128 * 1024;

/** Close code the browser maps to "offer the fallback". */
const LIVE_UNAVAILABLE = 4503;

export function createVoiceCoachSocketHandler(
  options: VoiceCoachSocketOptions,
): VoiceCoachSocketHandle {
  const { logger, verifyToken, devAuthBypass, service } = options;
  const registry = options.registry ?? createSessionRegistry({ logger });

  /** sessionId -> browser socket. */
  const sockets = new Map<string, WebSocket>();
  /** sessionId -> the running session, so the socket can drive it. */
  const sessions = new Map<string, RunningSession>();

  function send(sessionId: string, message: LiveServerMessage): void {
    const payload = JSON.stringify(message);
    const socket = sockets.get(sessionId);
    if (socket !== undefined && socket.readyState === socket.OPEN) socket.send(payload);
  }

  function closeSocket(sessionId: string, code: number, reason: string): void {
    const socket = sockets.get(sessionId);
    sockets.delete(sessionId);
    if (socket !== undefined && socket.readyState === socket.OPEN) {
      socket.close(code, reason.slice(0, 120));
    }
  }

  /** Ends the session and frees every resource. Safe to call twice. */
  async function finish(sessionId: string): Promise<void> {
    const session = sessions.get(sessionId);
    if (session !== undefined && session.ended === false) {
      try {
        await session.end();
      } catch (error) {
        logger.error({ err: error, sessionId }, 'coaching session end failed');
      }
    }
    sessions.delete(sessionId);
    sockets.delete(sessionId);
    registry.end(sessionId);
  }

  return {
    async connection(socket, request) {
      const params = new URL(request.url ?? '/', 'http://localhost').searchParams;
      const token = params.get('token');
      const devUid = params.get('dev_uid');

      let uid: string;
      try {
        if (devAuthBypass === true && devUid !== null && devUid.trim().length > 0) {
          uid = devUid.trim().slice(0, 128);
        } else if (token !== null && token.length > 0) {
          uid = (await verifyToken(token)).uid;
        } else {
          socket.close(4401, 'missing token');
          return;
        }
      } catch (error) {
        logger.debug({ err: error }, 'coaching socket rejected: bad token');
        socket.close(4401, 'invalid token');
        return;
      }

      if (registry.canStart(uid) === false) {
        logger.debug({ uid }, 'coaching socket rejected: daily cap');
        socket.close(4029, 'daily session cap reached');
        return;
      }

      const sessionId = randomUUID();
      sockets.set(sessionId, socket);

      socket.on('message', (raw: RawData) => {
        void (async () => {
          let parsed: unknown;
          try {
            parsed = JSON.parse(raw.toString());
          } catch {
            socket.send(
              JSON.stringify({
                type: 'error',
                error: { code: 'invalid_json', message: 'Messages must be JSON.' },
              }),
            );
            return;
          }

          // The first thing on the wire has to be the session start, so it is
          // checked before the streaming messages - otherwise a valid start
          // would be rejected as an unknown message type.
          if (sessions.has(sessionId) === false) {
            const start = liveSessionStartSchema.safeParse(parsed);
            if (start.success === false) {
              closeSocket(sessionId, 4400, 'first message must be a session start');
              return;
            }
            if (registry.canStart(uid) === false) {
              closeSocket(sessionId, 4029, 'daily session cap reached');
              return;
            }

            const session = await service
              .start({
                sessionId,
                uid,
                request: start.data,
                transport: {
                  send: (id, message) => send(id, message),
                  close: closeSocket,
                },
              })
              .catch((error: unknown) => {
                logger.warn({ err: error, uid, sessionId }, 'coaching session failed to start');
                return null;
              });

            if (session === null) {
              closeSocket(sessionId, LIVE_UNAVAILABLE, 'live_unavailable');
              return;
            }

            sessions.set(sessionId, session);
            registry.register({
              sessionId,
              uid,
              startedAtMs: session.startedAtMs,
              stop: (reason) => {
                if (reason === 'shutdown') void finish(sessionId);
              },
            });
            return;
          }

          const validated = liveClientMessageSchema.safeParse(parsed);
          if (validated.success === false) {
            socket.send(
              JSON.stringify({
                type: 'error',
                error: { code: 'invalid_message', message: 'Unrecognised coaching message.' },
              }),
            );
            return;
          }

          const message = validated.data;
          const session = sessions.get(sessionId);
          if (session === undefined) return;

          switch (message.type) {
            case 'audio': {
              if (Buffer.byteLength(message.data, 'base64') > MAX_AUDIO_FRAME_BYTES) {
                send(sessionId, {
                  type: 'warning',
                  message: 'Audio chunk too large; dropped.',
                });
                return;
              }
              session.sendAudio(Buffer.from(message.data, 'base64'));
              break;
            }

            case 'audio-stream-end':
              session.endAudioStream();
              break;

            case 'line':
              session.setLine(message.index);
              break;

            case 'end':
              await finish(sessionId);
              break;

            default:
              break;
          }
        })();
      });

      socket.on('close', () => {
        // A dropped connection must not leave a model session open.
        void finish(sessionId);
      });

      socket.on('error', (error: Error) => {
        logger.debug({ err: error, sessionId }, 'coaching socket error');
        void finish(sessionId);
      });

      logger.debug({ uid, sessionId, active: registry.activeCount() }, 'coaching socket open');
    },

    async shutdown() {
      const ids = [...sockets.keys()];
      for (const id of ids) {
        await finish(id);
      }
      registry.stopAll('shutdown');
      logger.info({ sessions: ids.length }, 'voice coach shut down');
    },
  };
}
