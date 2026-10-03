import { renderProgressEventSchema, type RenderProgressEvent } from '@creatordna/shared';
import { buildAuthHeaders } from './api';

/**
 * The render progress socket.
 *
 * One job, one socket: the browser subscribes by job id and the API refuses a
 * subscription to a render that is not the caller's own (checked against the job
 * document, never trusted from the client). Polling `GET /render/:id` is the
 * fallback when the socket is unavailable, not the primary path - a stage that
 * takes ninety seconds should not be polled every two.
 *
 * Modelled on `voiceCoachClient.ts` on purpose: same auth plumbing, same
 * reconnect discipline, same "validate every inbound message with the shared
 * schema" rule.
 */

/** Socket path on the API. Relative, so the Vite proxy works in dev and prod. */
const WS_PATH: string = import.meta.env.VITE_WS_PATH ?? '/ws';

/** Reconnects before giving up and falling back to polling. */
const MAX_RECONNECT_ATTEMPTS = 4;

const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 8000;

/** Backoff with jitter, so a dropped API does not get a thundering herd. */
export function reconnectDelayMs(attempt: number): number {
  const exponential = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** Math.max(0, attempt));
  return Math.round(exponential * (0.5 + Math.random() * 0.5));
}

export interface RenderSocketHandlers {
  /** A validated `render.progress` event for the subscribed job. */
  onProgress(event: RenderProgressEvent): void;
  /** The socket closed. `willReconnect` is false once we stop trying. */
  onClose?(info: { code: number; reason: string; willReconnect: boolean }): void;
  /** The socket could not be opened at all. */
  onError?(error: Error): void;
}

/** Builds the socket URL with the same auth the REST calls use. */
async function renderSocketUrl(): Promise<string> {
  const headers = await buildAuthHeaders();
  const params = new URLSearchParams();

  const authorization = headers.authorization;
  if (authorization !== undefined && authorization.startsWith('Bearer ')) {
    params.set('token', authorization.slice('Bearer '.length));
  }

  const devUid = headers['x-dev-uid'];
  if (devUid !== undefined && devUid.length > 0) params.set('dev_uid', devUid);

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const query = params.toString();
  const origin = import.meta.env.VITE_WS_ORIGIN || `${protocol}//${window.location.host}`;
  return `${origin}${WS_PATH}${query.length > 0 ? `?${query}` : ''}`;
}

export class RenderSocket {
  private socket: WebSocket | null = null;
  private jobId: string | null = null;
  private attempt = 0;
  private stopped = false;
  private reconnectTimer: number | null = null;

  constructor(private readonly handlers: RenderSocketHandlers) {}

  /** Opens the socket and subscribes to one job. */
  async connect(jobId: string): Promise<void> {
    this.jobId = jobId;
    this.stopped = false;
    this.attempt = 0;
    await this.openOnce();
  }

  private async openOnce(): Promise<void> {
    const jobId = this.jobId;
    if (jobId === null || this.stopped === true) return;

    const url = await renderSocketUrl();

    await new Promise<void>((resolve, reject) => {
      let socket: WebSocket;
      try {
        socket = new WebSocket(url);
      } catch (error) {
        reject(error instanceof Error ? error : new Error('Could not open the render socket.'));
        return;
      }

      this.socket = socket;

      socket.onopen = () => {
        this.attempt = 0;
        this.send({ type: 'render.subscribe', jobId });
        resolve();
      };

      socket.onmessage = (event: MessageEvent<unknown>) => {
        this.handleMessage(event.data);
      };

      socket.onerror = () => {
        if (socket.readyState === WebSocket.CONNECTING) {
          reject(new Error('The render progress socket could not be opened.'));
        }
      };

      socket.onclose = (event: CloseEvent) => {
        if (this.stopped === true) return;
        this.scheduleReconnect(event.code, event.reason);
      };
    });
  }

  /** Parses one inbound frame; anything unexpected is dropped, not rendered. */
  private handleMessage(data: unknown): void {
    let parsed: unknown;
    try {
      parsed = typeof data === 'string' ? (JSON.parse(data) as unknown) : data;
    } catch {
      return;
    }

    const result = renderProgressEventSchema.safeParse(parsed);
    if (result.success === false) {
      // `hello`, `pong`, `subscribe` acks and errors all land here. They are not
      // progress, and none of them should reach the progress handler.
      return;
    }
    if (this.jobId !== null && result.data.jobId !== this.jobId) return;

    this.handlers.onProgress(result.data);
  }

  private scheduleReconnect(code: number, reason: string): void {
    if (this.attempt >= MAX_RECONNECT_ATTEMPTS) {
      this.handlers.onClose?.({ code, reason, willReconnect: false });
      return;
    }

    const willReconnect = true;
    this.handlers.onClose?.({ code, reason, willReconnect });

    const delay = reconnectDelayMs(this.attempt);
    this.attempt += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      void this.openOnce().catch((error: unknown) => {
        this.handlers.onError?.(error instanceof Error ? error : new Error('Reconnect failed.'));
      });
    }, delay);
  }

  private send(message: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }

  /** True when the socket is open. */
  get isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  /** Closes for good. Safe to call twice. */
  dispose(): void {
    this.stopped = true;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close();
    this.socket = null;
  }
}
