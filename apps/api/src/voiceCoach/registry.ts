import {
  LIVE_LIMITS,
  dailyCapReached,
  remainingSessionSeconds,
  utcDayKey,
  type LiveLimits,
} from '@creatordna/shared';
import type { Logger } from 'pino';

/**
 * Live session registry.
 *
 * Tracks who is coaching right now and how many sessions each creator has
 * started today, so both limits are enforced in one place and every session is
 * guaranteed a cleanup path.
 *
 * In-memory by design: a coaching session is bound to one API process's socket,
 * so a shared registry would be a lie. If the API ever scales out, this becomes
 * a Redis hash - the interface below is already the right shape for it.
 */

export interface ActiveSession {
  readonly sessionId: string;
  readonly uid: string;
  readonly startedAtMs: number;
  /** Called when the session must stop (time limit, shutdown). */
  stop(reason: StopReason): void;
}

export type StopReason = 'time-limit' | 'client-ended' | 'error' | 'shutdown';

export interface SessionRegistry {
  /** True when this creator may start another session today. */
  canStart(uid: string): boolean;
  usedToday(uid: string): number;
  /** Registers a new session and counts it against the daily cap. */
  register(session: ActiveSession): void;
  /** Removes the session and returns how long it ran. */
  end(sessionId: string): number | null;
  activeCount(): number;
  /** Stops every session - used on shutdown so nothing is orphaned. */
  stopAll(reason: StopReason): void;
}

export interface SessionRegistryOptions {
  logger: Logger;
  limits?: LiveLimits;
  /** Injected in tests. */
  now?: () => number;
}

export function createSessionRegistry(options: SessionRegistryOptions): SessionRegistry {
  const { logger, limits = LIVE_LIMITS } = options;
  const now = options.now ?? (() => Date.now());

  const active = new Map<string, ActiveSession>();
  /** uid -> UTC day -> count. Two levels so yesterday's count expires naturally. */
  const dailyCounts = new Map<string, Map<string, number>>();

  function countFor(uid: string, day: string): number {
    return dailyCounts.get(uid)?.get(day) ?? 0;
  }

  return {
    canStart(uid) {
      return !dailyCapReached(countFor(uid, utcDayKey(new Date(now()))), limits.dailyCap);
    },

    usedToday(uid) {
      return countFor(uid, utcDayKey(new Date(now())));
    },

    register(session) {
      const day = utcDayKey(new Date(now()));
      const perDay = dailyCounts.get(session.uid) ?? new Map<string, number>();
      perDay.set(day, (perDay.get(day) ?? 0) + 1);
      dailyCounts.set(session.uid, perDay);
      active.set(session.sessionId, session);

      logger.info(
        {
          sessionId: session.sessionId,
          uid: session.uid,
          usedToday: perDay.get(day),
          active: active.size,
        },
        'live coaching session started',
      );
    },

    end(sessionId) {
      const session = active.get(sessionId);
      if (session === undefined) return null;
      active.delete(sessionId);
      const durationMs = Math.max(0, now() - session.startedAtMs);
      logger.info(
        { sessionId, uid: session.uid, durationMs, active: active.size },
        'live coaching session ended',
      );
      return durationMs;
    },

    activeCount() {
      return active.size;
    },

    stopAll(reason) {
      for (const session of [...active.values()]) {
        try {
          session.stop(reason);
        } catch (error) {
          logger.debug({ err: error, sessionId: session.sessionId }, 'session stop failed');
        }
      }
      active.clear();
    },
  };
}

/** Seconds left on a session, for the countdown the API pushes to the browser. */
export function secondsLeft(session: ActiveSession, nowMs: number, limits: LiveLimits = LIVE_LIMITS): number {
  return remainingSessionSeconds(session.startedAtMs, nowMs, limits.maxSessionSeconds);
}
