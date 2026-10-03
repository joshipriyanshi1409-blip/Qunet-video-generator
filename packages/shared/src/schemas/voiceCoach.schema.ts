import { z } from 'zod';

/**
 * Live Voice Coach contracts.
 *
 * The coach is a *live* feature: the browser streams microphone PCM to the API,
 * the API relays it to a Gemini Live session, and coaching tips come back while
 * the creator is still reading. Every value that crosses a boundary is validated
 * here, because a malformed tip mid-session is worse than no tip.
 */

/** The five things the coach is allowed to comment on. */
export const COACH_TIP_KINDS = ['pace', 'clarity', 'filler', 'energy', 'tone'] as const;

export const coachTipKindSchema = z.enum(COACH_TIP_KINDS);

export type CoachTipKind = z.infer<typeof coachTipKindSchema>;

/** How loudly to shout a tip. `good` is for praise, which matters as much. */
export const coachTipSeveritySchema = z.enum(['good', 'info', 'warning']);

export type CoachTipSeverity = z.infer<typeof coachTipSeveritySchema>;

export const coachTipSchema = z.object({
  kind: coachTipKindSchema,
  severity: coachTipSeveritySchema,
  /** One short sentence. Read aloud, it has to still make sense. */
  message: z.string().trim().min(1).max(280),
  /** Seconds into the session when the tip was raised. */
  atSeconds: z.number().nonnegative().max(86_400).optional(),
});

export type CoachTip = z.infer<typeof coachTipSchema>;

/** Labels for the five kinds, used by the feedback feed. */
export const COACH_TIP_LABELS: Readonly<Record<CoachTipKind, string>> = {
  pace: 'Pace',
  clarity: 'Clarity',
  filler: 'Filler words',
  energy: 'Energy',
  tone: 'Tone match',
};

/**
 * Hard limits, enforced server-side.
 *
 * A live session is the most expensive thing the product does, so both bounds
 * live here (not in the UI) and are re-checked on every session start.
 */
export const LIVE_MAX_SESSION_SECONDS = 300;

/** Live sessions one creator may start per calendar day (UTC). */
export const LIVE_DAILY_SESSION_CAP = 10;

/** Audio format the browser must send and the model expects. */
export const LIVE_AUDIO_FORMAT = {
  /** Samples per second, after downsampling. */
  sampleRate: 16_000,
  /** Bits per sample. */
  bitDepth: 16,
  channels: 1,
  /** MIME type string the Live API documents for PCM input. */
  mimeType: 'audio/pcm;rate=16000',
} as const;

/** Bytes in one PCM sample: 16-bit mono. */
export const LIVE_PCM_BYTES_PER_SAMPLE = LIVE_AUDIO_FORMAT.bitDepth / 8;

/**
 * The script the creator is reading, split into lines.
 *
 * Lines, not one blob: the teleprompter highlights the current line, so the
 * boundary has to exist before the audio does.
 */
export const liveSessionScriptSchema = z
  .array(z.string().trim().min(1).max(600))
  .min(1)
  .max(40);

export type LiveSessionScript = z.infer<typeof liveSessionScriptSchema>;

/**
 * The first message on the coaching socket.
 *
 * `type` is optional so the same schema validates a REST-style body that omits
 * it, but the browser always sends it: a socket where the first frame says what
 * it is costs nothing and saves the next reader a guess.
 */
export const liveSessionStartSchema = z.object({
  type: z.literal('start').optional(),
  /** The project whose approved version is being rehearsed. */
  projectId: z.string().trim().min(1).max(128).optional(),
  script: liveSessionScriptSchema,
});

export type LiveSessionStart = z.infer<typeof liveSessionStartSchema>;

/** What the browser is allowed to tell the API over the coaching socket. */
export const liveClientMessageSchema = z.discriminatedUnion('type', [
  /** Raw PCM bytes, already downsampled to 16 kHz mono 16-bit. */
  z.object({ type: z.literal('audio'), data: z.string().min(1) }),
  /** The creator stopped talking; flush what is buffered. */
  z.object({ type: z.literal('audio-stream-end') }),
  /** The line index the creator is on, so the server can pace the tips. */
  z.object({ type: z.literal('line'), index: z.number().int().nonnegative().max(40) }),
  /** End the session and ask for the summary. */
  z.object({ type: z.literal('end') }),
]);

export type LiveClientMessage = z.infer<typeof liveClientMessageSchema>;

/** What the API is allowed to send the browser. */
export const liveServerMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready'), sessionId: z.string(), maxSeconds: z.number() }),
  z.object({ type: z.literal('tip'), tip: coachTipSchema }),
  z.object({ type: z.literal('transcript'), text: z.string(), final: z.boolean() }),
  /** Model audio feedback, base64 PCM. Played straight back to the creator. */
  z.object({ type: z.literal('audio'), data: z.string(), mimeType: z.string() }),
  z.object({ type: z.literal('warning'), message: z.string() }),
  z.object({
    type: z.literal('ended'),
    summary: z.lazy(() => liveSessionSummarySchema),
  }),
  z.object({
    type: z.literal('error'),
    error: z.object({ code: z.string(), message: z.string() }),
  }),
]);

export type LiveServerMessage = z.infer<typeof liveServerMessageSchema>;

/** End-of-session summary, saved to the creator's history. */
export const liveSessionSummarySchema = z.object({
  strengths: z.array(z.string().trim().min(1).max(280)).max(6),
  issues: z.array(z.string().trim().min(1).max(280)).max(6),
  tips: z.array(z.string().trim().min(1).max(280)).max(8),
  /** How long the take actually ran, in seconds. */
  durationSeconds: z.number().nonnegative().max(86_400),
  /** Lines the creator read, by index. */
  linesRead: z.number().int().nonnegative().max(40),
});

export type LiveSessionSummary = z.infer<typeof liveSessionSummarySchema>;

/**
 * Fallback mode: the whole take is recorded, then sent for feedback after the
 * fact. Used when the live model is unavailable - and as the first thing a
 * creator sees when they grant the mic but the socket will not open.
 */
export const liveFeedbackRequestSchema = z.object({
  projectId: z.string().trim().min(1).max(128).optional(),
  script: liveSessionScriptSchema,
  /** Base64 PCM of the full take, 16 kHz mono 16-bit. */
  audio: z.string().min(1),
  /** How long the take ran, in seconds. */
  durationSeconds: z.number().nonnegative().max(86_400),
});

export type LiveFeedbackRequest = z.infer<typeof liveFeedbackRequestSchema>;

export const liveFeedbackResponseSchema = z.object({
  summary: liveSessionSummarySchema,
  /** Live tips, same shape as the ones the socket would have delivered. */
  tips: z.array(coachTipSchema).max(20),
  /** True when the live path was unavailable and this was post-processed. */
  fallback: z.boolean(),
});

export type LiveFeedbackResponse = z.infer<typeof liveFeedbackResponseSchema>;

/** `GET /voice-coach/quota` - what the creator has left today. */
export const liveQuotaResponseSchema = z.object({
  usedToday: z.number().int().nonnegative(),
  dailyCap: z.number().int().positive(),
  remainingToday: z.number().int().nonnegative(),
  maxSessionSeconds: z.number().int().positive(),
});

export type LiveQuotaResponse = z.infer<typeof liveQuotaResponseSchema>;

/** Close codes the coaching socket uses, so the browser can branch on them. */
export const LIVE_WS_CLOSE = {
  /** Session hit the per-session maximum. */
  timeLimit: 4001,
  /** Daily cap reached. */
  quota: 4029,
  /** Live model unavailable - the browser should offer the fallback. */
  liveUnavailable: 4503,
} as const;
