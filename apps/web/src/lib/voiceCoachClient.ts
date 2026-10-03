import {
  LIVE_WS_CLOSE,
  liveClientMessageSchema,
  liveFeedbackRequestSchema,
  liveFeedbackResponseSchema,
  liveQuotaResponseSchema,
  liveServerMessageSchema,
  liveSessionStartSchema,
  reconnectDelayMs,
  type LiveClientMessage,
  type LiveFeedbackRequest,
  type LiveFeedbackResponse,
  type LiveQuotaResponse,
  type LiveServerMessage,
  type LiveSessionStart,
} from '@creatordna/shared';
import { buildAuthHeaders, request } from './api';

/**
 * The coaching WebSocket, and the two REST calls that sit beside it.
 *
 * Everything that talks to the coach lives here so the hook stays about state
 * and the page stays about layout. Messages are validated with the shared
 * schemas on both sides of the socket: a backend change that breaks the contract
 * fails loudly instead of putting `undefined` in the feedback feed.
 */

/**
 * Socket path on the API.
 *
 * Kept in sync with the API's `VOICE_COACH_WS_PATH`. A relative path works in
 * dev and production because the Vite dev server proxies `/ws` to the API.
 */
const WS_PATH: string = import.meta.env.VITE_VOICE_COACH_WS_PATH ?? '/ws/voice-coach';

/** Reconnects before giving up and offering the fallback. */
const MAX_RECONNECT_ATTEMPTS = 5;

/** Builds the socket URL with the same auth the REST calls use. */
async function coachSocketUrl(): Promise<string> {
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

export interface VoiceCoachSocketHandlers {
  /** Every message the API sends, already schema-validated. */
  onMessage(message: LiveServerMessage): void;
  /** The socket closed. `willReconnect` is false on a policy close. */
  onClose?(info: { code: number; reason: string; willReconnect: boolean }): void;
  /** The socket could not be opened at all. */
  onError?(error: Error): void;
}

/**
 * One coaching session over one WebSocket.
 *
 * Reconnects with exponential backoff when the network drops, but never when the
 * API closed on purpose (daily cap, time limit, live unavailable). Those are
 * answers rather than accidents, and retrying them would only burn the creator's
 * daily allowance.
 */
export class VoiceCoachSocket {
  private socket: WebSocket | null = null;
  private attempt = 0;
  private stopped = false;
  private reconnectTimer: number | null = null;
  private start: LiveSessionStart | null = null;

  constructor(private readonly handlers: VoiceCoachSocketHandlers) {}

  /** Opens the socket and sends the session start. */
  async connect(start: LiveSessionStart): Promise<void> {
    this.start = start;
    this.stopped = false;
    this.attempt = 0;
    await this.openOnce();
  }

  private async openOnce(): Promise<void> {
    if (this.start === null) return;

    const url = await coachSocketUrl();

    await new Promise<void>((resolve, reject) => {
      let socket: WebSocket;
      try {
        socket = new WebSocket(url);
      } catch (error) {
        reject(error instanceof Error ? error : new Error('Could not open the coach socket.'));
        return;
      }

      this.socket = socket;

      socket.onopen = () => {
        this.attempt = 0;
        if (this.start !== null) this.sendStart(this.start);
        resolve();
      };

      socket.onmessage = (event: MessageEvent<unknown>) => {
        const parsed = parseServerMessage(event.data);
        if (parsed !== null) this.handlers.onMessage(parsed);
      };

      socket.onerror = () => {
        if (socket.readyState === WebSocket.CONNECTING) {
          reject(new Error('The coaching socket could not be opened.'));
        }
      };

      socket.onclose = (event: CloseEvent) => {
        const willReconnect = this.shouldReconnect(event.code);
        this.handlers.onClose?.({ code: event.code, reason: event.reason, willReconnect });
        if (willReconnect === false) return;

        this.attempt += 1;
        this.reconnectTimer = window.setTimeout(() => {
          this.reconnectTimer = null;
          if (this.stopped || this.start === null) return;
          void this.openOnce().catch(() => {
            // The next close event decides whether to try again.
          });
        }, reconnectDelayMs(this.attempt));
      };
    });
  }

  /**
   * True when a dropped socket should be retried.
   *
   * The shared helper already knows the answer for policy close codes; the
   * attempt ceiling is what stops a flapping network from reconnecting forever.
   */
  private shouldReconnect(code: number): boolean {
    if (this.stopped === true) return false;
    if (code === LIVE_WS_CLOSE.timeLimit) return false;
    if (code === LIVE_WS_CLOSE.quota) return false;
    if (code === LIVE_WS_CLOSE.liveUnavailable) return false;
    return this.attempt < MAX_RECONNECT_ATTEMPTS;
  }

  /** Sends the session start, validated against the shared schema. */
  private sendStart(start: LiveSessionStart): void {
    if (this.socket === null || this.socket.readyState !== WebSocket.OPEN) return;
    const parsed = liveSessionStartSchema.safeParse({ type: 'start', ...start });
    if (parsed.success === false) return;
    this.socket.send(JSON.stringify(parsed.data));
  }

  /** Sends one streaming message, validated against the shared schema. */
  send(message: LiveClientMessage): void {
    if (this.socket === null || this.socket.readyState !== WebSocket.OPEN) return;
    const parsed = liveClientMessageSchema.safeParse(message);
    if (parsed.success === false) return;
    this.socket.send(JSON.stringify(parsed.data));
  }

  /** Ends the session cleanly, so the API can save the summary. */
  end(): void {
    this.stopped = true;
    this.clearReconnect();
    this.send({ type: 'end' } as LiveClientMessage);
  }

  /** Closes without ending - used when the creator navigates away. */
  dispose(): void {
    this.stopped = true;
    this.clearReconnect();
    this.socket?.close();
    this.socket = null;
  }

  /** True while the socket is open. */
  get isOpen(): boolean {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN;
  }

  private clearReconnect(): void {
    if (this.reconnectTimer === null) return;
    window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }
}

/**
 * Fallback mode: record the whole take, then send it for feedback afterwards.
 *
 * This is the path that keeps the feature useful when the Live API is down, so it
 * is a first-class call rather than an error handler.
 */
export function submitFallbackTake(
  input: Omit<LiveFeedbackRequest, 'audio'> & { audio: Uint8Array },
): Promise<LiveFeedbackResponse> {
  const payload = liveFeedbackRequestSchema.parse({ ...input, audio: bytesToBase64(input.audio) });
  return request('/api/v1/voice-coach/feedback', liveFeedbackResponseSchema, {
    method: 'POST',
    body: payload,
  });
}

/** `GET /voice-coach/quota` - sessions left today. */
export function fetchCoachQuota(): Promise<LiveQuotaResponse> {
  return request('/api/v1/voice-coach/quota', liveQuotaResponseSchema);
}

/** Base64 for a whole take. Chunked so a long recording cannot blow the stack. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

/**
 * Validates one inbound message.
 *
 * A malformed message is dropped rather than thrown: one bad tip must not take
 * the session down with it.
 */
export function parseServerMessage(data: unknown): LiveServerMessage | null {
  let payload: unknown = data;
  if (typeof data === 'string') {
    try {
      payload = JSON.parse(data) as unknown;
    } catch {
      return null;
    }
  }

  const parsed = liveServerMessageSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

export { WS_PATH as VOICE_COACH_WS_PATH };
