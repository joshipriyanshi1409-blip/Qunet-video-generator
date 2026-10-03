import type { CoachTip, LiveSessionScript } from '@creatordna/shared';

/**
 * The seam every live model call goes through.
 *
 * Same rule as `TextModelClient`: the API never talks to a model SDK directly.
 * `LiveSessionProvider` is the one place the Gemini Live protocol is spelled out,
 * so a broken or changed upstream only breaks this module - never the rest of the
 * API, and never another feature.
 */

/** Something the model said or sent while the session was open. */
export type LiveSessionEvent =
  | { kind: 'text'; text: string }
  | { kind: 'tip'; tip: CoachTip }
  | { kind: 'transcript'; text: string; final: boolean }
  /** Base64 PCM the browser can play back as spoken feedback. */
  | { kind: 'audio'; data: string; mimeType: string }
  | { kind: 'closed' };

export interface LiveSessionOptions {
  /**
   * Model id from `GEMINI_LIVE_MODEL`. Never hard-coded.
   *
   * Optional so an unconfigured deployment fails with a message that names the
   * variable, rather than silently using a model nobody chose.
   */
  model?: string;
  /** The coaching system instruction. */
  systemInstruction: string;
  /** What to say to the model once the session is open. */
  openingPrompt: string;
  script: LiveSessionScript;
}

export interface LiveSessionHandle {
  /** Streams one chunk of 16 kHz mono 16-bit PCM. */
  sendAudio(pcm: Buffer): void;
  /** Tells the model the creator stopped talking. */
  endAudioStream(): void;
  /** Sends a text turn, e.g. the final "wrap up" request. */
  sendText(text: string): void;
  /** Reads the next event. Resolves `{ kind: 'closed' }` when the model hangs up. */
  next(): Promise<LiveSessionEvent>;
  /** Frees the upstream socket. Idempotent. */
  close(): Promise<void>;
}

export interface LiveSessionProvider {
  /** Adapter name, logged with every session (`gemini-live`, `stub-live`). */
  readonly name: string;
  /** True when this provider can actually reach a model. */
  readonly available: boolean;
  open(options: LiveSessionOptions): Promise<LiveSessionHandle>;
}

/** Thrown when the live model cannot be reached at all. */
export class LiveProviderError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable = false, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'LiveProviderError';
    this.retryable = retryable;
  }
}

/**
 * Splits a tip out of a model turn.
 *
 * The model is asked for JSON tips, but a live session is a conversation: it will
 * sometimes just talk. This keeps the coaching dimension when it can parse one
 * and falls back to plain text otherwise, so a chatty model degrades to a
 * transcript rather than to nothing.
 */
export function extractTip(text: string): CoachTip | null {
  const jsonMatch = /\{[^{}]*"kind"[^{}]*\}/.exec(text);
  if (jsonMatch === null) return null;
  try {
    const parsed: unknown = JSON.parse(jsonMatch[0]);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const candidate = parsed as Record<string, unknown>;
    const kind = typeof candidate['kind'] === 'string' ? candidate['kind'] : '';
    const severity = typeof candidate['severity'] === 'string' ? candidate['severity'] : 'info';
    const message = typeof candidate['message'] === 'string' ? candidate['message'] : '';
    return {
      kind: kind as CoachTip['kind'],
      severity: severity as CoachTip['severity'],
      message,
      atSeconds: typeof candidate['atSeconds'] === 'number' ? candidate['atSeconds'] : undefined,
    };
  } catch {
    return null;
  }
}
