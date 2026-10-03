import {
  LIVE_DAILY_SESSION_CAP,
  LIVE_MAX_SESSION_SECONDS,
  type LiveQuotaResponse,
} from '../schemas/voiceCoach.schema.js';

/**
 * Pure session-limit math.
 *
 * Kept out of the service so the rules ("a session ends at N seconds", "a
 * creator gets M per day") are testable without a clock, a socket or a database,
 * and so the browser can show the same numbers the server will enforce.
 */

export interface LiveLimits {
  readonly maxSessionSeconds: number;
  readonly dailyCap: number;
}

export const LIVE_LIMITS: LiveLimits = {
  maxSessionSeconds: LIVE_MAX_SESSION_SECONDS,
  dailyCap: LIVE_DAILY_SESSION_CAP,
};

/**
 * The UTC calendar day a timestamp belongs to.
 *
 * The cap is per *day*, and the day boundary has to be the same for every
 * creator, so it is UTC rather than the creator's local midnight - otherwise a
 * creator near the line could start two sessions "on the same day".
 */
export function utcDayKey(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/** True when another session may be started. */
export function dailyCapReached(usedToday: number, dailyCap: number): boolean {
  return usedToday >= dailyCap;
}

/** Seconds left before the per-session maximum cuts the session off. */
export function remainingSessionSeconds(
  startedAtMs: number,
  nowMs: number,
  maxSessionSeconds: number,
): number {
  const elapsedMs = Math.max(0, nowMs - startedAtMs);
  return Math.max(0, Math.ceil((maxSessionSeconds * 1000 - elapsedMs) / 1000));
}

/** True once the session has run past its maximum. */
export function sessionTimeExpired(
  startedAtMs: number,
  nowMs: number,
  maxSessionSeconds: number,
): boolean {
  return remainingSessionSeconds(startedAtMs, nowMs, maxSessionSeconds) <= 0;
}

/** Fraction of the session consumed, 0-1, for the countdown ring. */
export function sessionProgress(
  startedAtMs: number,
  nowMs: number,
  maxSessionSeconds: number,
): number {
  const elapsed = Math.max(0, nowMs - startedAtMs);
  return Math.min(1, elapsed / (maxSessionSeconds * 1000));
}

/** How many sessions the creator may still start today. */
export function remainingToday(usedToday: number, dailyCap: number): number {
  return Math.max(0, dailyCap - usedToday);
}

/** The quota payload the UI renders. */
export function toQuotaResponse(usedToday: number, limits: LiveLimits = LIVE_LIMITS): LiveQuotaResponse {
  return {
    usedToday,
    dailyCap: limits.dailyCap,
    remainingToday: remainingToday(usedToday, limits.dailyCap),
    maxSessionSeconds: limits.maxSessionSeconds,
  };
}

/**
 * Backoff for the browser's reconnect, in milliseconds.
 *
 * Exponential with a cap, and jittered: without jitter, every client that was
 * connected when the API restarted reconnects on the same tick and hammers it.
 */
export function reconnectDelayMs(attempt: number, baseMs = 500, maxMs = 15_000): number {
  const exponential = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(exponential / 2 + Math.random() * (exponential / 2));
}

/**
 * Whether a reconnect is worth attempting at all.
 *
 * A close with a policy code (time limit, quota) is the API saying "do not come
 * back"; reconnecting then just burns the creator's battery and the server's
 * accept queue.
 */
export function shouldReconnect(closeCode: number): boolean {
  return closeCode === 1000 || closeCode === 1006 || closeCode === 1011 || closeCode === 1012;
}
