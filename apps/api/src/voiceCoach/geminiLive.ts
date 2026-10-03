import WebSocket from 'ws';
import { LIVE_AUDIO_FORMAT } from '@creatordna/shared';
import {
  LiveProviderError,
  type LiveSessionEvent,
  type LiveSessionHandle,
  type LiveSessionOptions,
  type LiveSessionProvider,
} from './types.js';

/**
 * Gemini Live adapter over the documented BidiGenerateContent WebSocket.
 *
 * ============================================================================
 * VERIFY BEFORE RELYING ON THIS FILE
 * ============================================================================
 * The wire shape below follows Google's official Live API documentation:
 *
 *   https://ai.google.dev/gemini-api/docs/live-api/get-started-websocket
 *   https://ai.google.dev/api/live            (WebSockets API reference)
 *
 * Three things there are known to move, and this file is the only place they
 * are written down:
 *
 *   1. The API version in the path - docs show BOTH `v1alpha` (older pages and
 *      community posts) and `v1beta` (current get-started page). We use `v1beta`
 *      and expose it as `apiVersion` so it is a one-line change.
 *   2. Field naming - the raw WebSocket JSON is camelCase (`systemInstruction`,
 *      `generationConfig`, `modelTurn`, `inlineData`), while the Python SDK is
 *      snake_case. We speak the camelCase wire form.
 *   3. `responseModalities` - `["AUDIO"]` alone, or `["AUDIO", "TEXT"]` when the
 *      model should also send text we can turn into tips.
 *
 * If a session fails to reach `setupComplete`, check those three against the
 * docs above before changing anything else. Nothing outside this file needs to
 * change.
 * ============================================================================
 */

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';

export interface GeminiLiveProviderOptions {
  apiKey: string;
  /** Overridable for tests and for a proxy. */
  baseUrl?: string;
  /** `v1alpha` or `v1beta` - see the note above. */
  apiVersion?: string;
  /** Injectable for tests. */
  WebSocketImpl?: typeof WebSocket;
  /** How long to wait for `setupComplete` before giving up. */
  setupTimeoutMs?: number;
}

interface LiveServerMessage {
  setupComplete?: unknown;
  serverContent?: {
    modelTurn?: { parts?: { text?: string; inlineData?: { data?: string; mimeType?: string } }[] };
    inputTranscription?: { text?: string };
    turnComplete?: boolean;
    interrupted?: boolean;
  };
  error?: { message?: string; code?: number };
}

/** Builds the authenticated WebSocket URL. */
export function buildLiveUrl(options: GeminiLiveProviderOptions): string {
  const base = options.baseUrl ?? DEFAULT_BASE_URL;
  const version = options.apiVersion ?? 'v1beta';
  const path = `google.ai.generativelanguage.${version}.GenerativeService.BidiGenerateContent`;
  const url = new URL(`${base.replace(/^http/, 'ws')}/ws/${path}`);
  url.searchParams.set('key', options.apiKey);
  return url.toString();
}

/** The first message on the socket: session configuration. */
export function buildSetupMessage(options: LiveSessionOptions): Record<string, unknown> {
  return {
    setup: {
      model: `models/${options.model ?? ''}`,
      // AUDIO so the coach can *speak* tips; TEXT so the browser can render
      // them immediately and the session survives without a speaker.
      generationConfig: { responseModalities: ['AUDIO', 'TEXT'] },
      systemInstruction: { parts: [{ text: options.systemInstruction }] },
      // Transcribing the creator's own audio is what makes pace and filler-word
      // coaching possible at all.
      inputAudioTranscription: {},
    },
  };
}

/** Wraps one PCM chunk for the realtime input stream. */
export function buildAudioMessage(pcm: Buffer): Record<string, unknown> {
  return {
    realtimeInput: {
      audio: {
        data: pcm.toString('base64'),
        mimeType: LIVE_AUDIO_FORMAT.mimeType,
      },
    },
  };
}

/** Tells the model the microphone went quiet. */
export function buildAudioStreamEndMessage(): Record<string, unknown> {
  return { realtimeInput: { audioStreamEnd: true } };
}

/** A text turn, used for the closing "wrap up" request. */
export function buildClientContentMessage(text: string): Record<string, unknown> {
  return {
    clientContent: {
      turns: [{ role: 'user', parts: [{ text }] }],
      turnComplete: true,
    },
  };
}

/** Maps a server message onto the events this module understands. */
export function toSessionEvents(message: LiveServerMessage): LiveSessionEvent[] {
  if (message.error !== undefined) {
    throw new LiveProviderError(message.error.message ?? 'live model error', false);
  }

  const content = message.serverContent;
  if (content === undefined) return [];

  const events: LiveSessionEvent[] = [];

  const transcription = content.inputTranscription;
  if (transcription?.text !== undefined && transcription.text.length > 0) {
    events.push({ kind: 'transcript', text: transcription.text, final: true });
  }

  for (const part of content.modelTurn?.parts ?? []) {
    if (part.text !== undefined && part.text.length > 0) {
      events.push({ kind: 'text', text: part.text });
    }
    const inline = part.inlineData;
    if (inline?.data !== undefined && inline.data.length > 0) {
      events.push({ kind: 'audio', data: inline.data, mimeType: inline.mimeType ?? 'audio/pcm' });
    }
  }

  return events;
}

/**
 * Opens a Gemini Live session.
 *
 * Rejected with `LiveProviderError` when the key is missing, the socket will not
 * open, or `setupComplete` never arrives - the caller turns that into the
 * fallback path rather than a dead coaching screen.
 */
export function createGeminiLiveProvider(
  options: GeminiLiveProviderOptions,
): LiveSessionProvider {
  const Impl = options.WebSocketImpl ?? WebSocket;
  const setupTimeoutMs = options.setupTimeoutMs ?? 10_000;

  return {
    name: 'gemini-live',
    available: options.apiKey.trim().length > 0,

    async open(sessionOptions: LiveSessionOptions): Promise<LiveSessionHandle> {
      if (options.apiKey.trim().length === 0) {
        throw new LiveProviderError('GEMINI_API_KEY is not configured.');
      }
      if ((sessionOptions.model ?? '').trim().length === 0) {
        throw new LiveProviderError(
          'GEMINI_LIVE_MODEL is not configured - set it in the API environment.',
        );
      }

      const socket = new Impl(buildLiveUrl(options));

      // A queue, not a callback: `next()` is pull-based so the service can read
      // events at its own pace without buffering the whole session in memory.
      const queue: LiveSessionEvent[] = [];
      let closed = false;
      let failure: Error | null = null;
      let notify: (() => void) | null = null;

      function wake(): void {
        const resolve = notify;
        notify = null;
        resolve?.();
      }

      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new LiveProviderError(`Live session setup timed out after ${setupTimeoutMs}ms.`, true));
        }, setupTimeoutMs);

        socket.on('open', () => {
          socket.send(JSON.stringify(buildSetupMessage(sessionOptions)));
        });

        socket.on('message', (raw: WebSocket.RawData) => {
          let message: LiveServerMessage;
          try {
            message = JSON.parse(raw.toString()) as LiveServerMessage;
          } catch {
            return;
          }

          if (message.setupComplete !== undefined) {
            clearTimeout(timer);
            resolve();
            return;
          }

          try {
            queue.push(...toSessionEvents(message));
            wake();
          } catch (error) {
            clearTimeout(timer);
            failure = error instanceof Error ? error : new Error(String(error));
            reject(failure);
          }
        });

        socket.on('error', (error: Error) => {
          clearTimeout(timer);
          reject(new LiveProviderError(error.message, true, error));
        });

        socket.on('close', () => {
          clearTimeout(timer);
          closed = true;
          queue.push({ kind: 'closed' });
          wake();
        });
      });

      return {
        sendAudio(pcm: Buffer) {
          if (closed || socket.readyState !== socket.OPEN) return;
          socket.send(JSON.stringify(buildAudioMessage(pcm)));
        },

        endAudioStream() {
          if (closed || socket.readyState !== socket.OPEN) return;
          socket.send(JSON.stringify(buildAudioStreamEndMessage()));
        },

        sendText(text: string) {
          if (closed || socket.readyState !== socket.OPEN) return;
          socket.send(JSON.stringify(buildClientContentMessage(text)));
        },

        async next(): Promise<LiveSessionEvent> {
          for (;;) {
            const event = queue.shift();
            if (event !== undefined) return event;
            if (closed || failure !== null) return { kind: 'closed' };
            await new Promise<void>((resolve) => {
              notify = resolve;
            });
          }
        },

        // Not `async`: the upstream socket close is fire-and-forget, and
        // pretending to await it would only satisfy a lint rule.
        close(): Promise<void> {
          if (closed) return Promise.resolve();
          closed = true;
          socket.close(1000, 'session ended');
          queue.push({ kind: 'closed' });
          wake();
          return Promise.resolve();
        },
      };
    },
  };
}
