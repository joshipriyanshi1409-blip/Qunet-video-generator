import {
  LIVE_LIMITS,
  buildDnaContext,
  toQuotaResponse,
  liveFeedbackRequestSchema,
  liveFeedbackResponseSchema,
  liveSessionStartSchema,
  liveSessionSummarySchema,
  type CreatorDna,
  type LiveFeedbackRequest,
  type LiveFeedbackResponse,
  type LiveServerMessage,
  type LiveSessionStart,
  type LiveSessionSummary,
  type LiveQuotaResponse,
} from '@creatordna/shared';
import type { Logger } from 'pino';
import { ServiceUnavailableError, ValidationError } from '../lib/errors.js';
import type { DnaRepository } from '../lib/dnaRepository.js';
import { buildCoachInstruction } from './systemInstruction.js';
import type { SessionRegistry } from './registry.js';
import type { LiveSessionEvent, LiveSessionHandle, LiveSessionProvider } from './types.js';
import { extractTip } from './types.js';

/**
 * Live Voice Coach service.
 *
 * Owns the loop that makes a coaching session real:
 *
 *   browser PCM -> provider -> model events -> tips/transcript/audio -> browser
 *
 * and, at the end, turns what happened into a summary saved to the creator's
 * history. Everything that can fail has a defined degradation:
 *
 *   - no DNA yet        -> 404 with a pointer to onboarding
 *   - daily cap reached -> 409, no socket opened
 *   - live model down   -> the socket closes with `liveUnavailable` and the
 *                          browser offers the post-recording fallback
 *   - model chatty      -> the text still reaches the browser as a transcript
 *
 * Nothing here throws into another feature: the coach is reachable only through
 * its own route and its own socket path, so a failure is contained by
 * construction.
 */

export interface VoiceCoachServiceDeps {
  provider: LiveSessionProvider;
  dnaRepository: DnaRepository;
  logger: Logger;
  /**
   * Live model id, from `GEMINI_LIVE_MODEL`.
   *
   * Optional so a deployment without a configured live model degrades to the
   * fallback path instead of failing to boot. The provider is what rejects an
   * unusable model, with a message that names the variable.
   */
  model?: string;
  /** Saves the end-of-session summary to the creator's history. */
  saveSummary(uid: string, summary: LiveSessionSummary, projectId?: string): Promise<void>;
  /** Tracks the daily cap. */
  registry: SessionRegistry;
}

/** A running session, from the service's point of view. */
export interface RunningSession {
  readonly sessionId: string;
  readonly uid: string;
  readonly projectId?: string;
  readonly script: readonly string[];
  readonly startedAtMs: number;
  /** Seconds of session left, recomputed on each call. */
  remainingSeconds(): number;
  /** Feeds one PCM chunk to the model. */
  sendAudio(pcm: Buffer): void;
  /** Creator stopped talking. */
  endAudioStream(): void;
  /** Creator moved to another script line. */
  setLine(index: number): void;
  /** Ends the session, saves the summary and closes the socket. Idempotent. */
  end(): Promise<void>;
  /** True once `end()` has run, so cleanup never double-saves. */
  readonly ended: boolean;
}

/** How one session talks to its browser socket. Passed per session, not global. */
export interface SessionTransport {
  send(sessionId: string, message: LiveServerMessage): void;
  close(sessionId: string, code: number, reason: string): void;
}

export interface VoiceCoachService {
  start(input: {
    sessionId: string;
    uid: string;
    request: LiveSessionStart;
    transport: SessionTransport;
  }): Promise<RunningSession>;
  /** Post-recording fallback: coach a whole take after the fact. */
  feedback(uid: string, request: LiveFeedbackRequest): Promise<LiveFeedbackResponse>;
  /** Sessions left for this creator today. */
  quota(uid: string): LiveQuotaResponse;
}

/** The text turn that asks the model for the closing wrap-up. */
const WRAP_UP_PROMPT =
  'That was the end of my take. Give me the wrap-up now: one strength, one issue, ' +
  'and one thing to try next take. Keep it under 40 words.';

/** How long to wait for the wrap-up before saving whatever we have. */
const WRAP_UP_TIMEOUT_MS = 15_000;
/**
 * How long the wrap-up waits for the model to stop talking.
 *
 * Ending a session should feel instant, so the service does not sit out the
 * full timeout once the model has answered and gone quiet.
 */
const WRAP_UP_QUIET_MS = 1_200;

/** Close code the browser maps to "offer the fallback". */
const LIVE_UNAVAILABLE = 4503;

export function createVoiceCoachService(deps: VoiceCoachServiceDeps): VoiceCoachService {
  const { provider, dnaRepository, logger, model, saveSummary, registry } = deps;

  async function requireDna(uid: string): Promise<CreatorDna> {
    const dna = await dnaRepository.get(uid);
    if (dna === null) {
      throw new ValidationError(
        'Finish onboarding first - the coach needs your DNA to coach you.',
      );
    }
    return dna;
  }

  return {
    async start({ sessionId, uid, request, transport }) {
      const { send, close } = transport;
      const validated = liveSessionStartSchema.parse(request);
      const dna = await requireDna(uid);

      const instruction = buildCoachInstruction({ uid, dna, script: validated.script });

      let handle: LiveSessionHandle;
      try {
        handle = await provider.open({
          model,
          systemInstruction: instruction.system,
          openingPrompt: instruction.openingPrompt,
          script: validated.script,
        });
      } catch (error) {
        logger.warn(
          { uid, sessionId, err: error, provider: provider.name },
          'live coaching session could not open',
        );
        close(sessionId, LIVE_UNAVAILABLE, 'live_unavailable');
        throw error;
      }

      const startedAtMs = Date.now();
      const maxMs = LIVE_LIMITS.maxSessionSeconds * 1000;
      let ended = false;
      let lineIndex = 0;

      const elapsedSeconds = (): number => Math.round((Date.now() - startedAtMs) / 1000);

      /**
       * Every model event, in order.
       *
       * The pump is the only reader of the provider. Two loops both calling
       * `next()` would race - whichever parked its waiter first wins each event -
       * and the wrap-up would then always come back empty.
       */
      const seen: LiveSessionEvent[] = [];
      const eventWaiters: (() => void)[] = [];

      function noteEvent(event: LiveSessionEvent): void {
        seen.push(event);
        eventWaiters.shift()?.();
      }

      /** Wakes on the next model event, or after `ms`, whichever comes first. */
      function waitForEvent(ms: number): Promise<void> {
        return new Promise<void>((resolve) => {
          const done = (): void => {
            const index = eventWaiters.indexOf(done);
            if (index >= 0) eventWaiters.splice(index, 1);
            resolve();
          };
          eventWaiters.push(done);
          setTimeout(done, ms);
        });
      }

      /** Pushes one model event at the browser. */
      function relay(event: LiveSessionEvent): void {
        switch (event.kind) {
          case 'tip':
            send(sessionId, {
              type: 'tip',
              tip: { ...event.tip, atSeconds: event.tip.atSeconds ?? elapsedSeconds() },
            });
            break;

          case 'text': {
            const tip = extractTip(event.text);
            if (tip !== null) {
              send(sessionId, { type: 'tip', tip: { ...tip, atSeconds: elapsedSeconds() } });
            } else {
              send(sessionId, { type: 'transcript', text: event.text, final: false });
            }
            break;
          }

          case 'transcript':
            send(sessionId, { type: 'transcript', text: event.text, final: event.final });
            break;

          case 'audio':
            // Model audio feedback - played straight back to the creator.
            send(sessionId, { type: 'audio', data: event.data, mimeType: event.mimeType });
            break;

          default:
            break;
        }
      }

      /** Reads model events until the session ends. Never rejects. */
      async function pump(): Promise<void> {
        for (;;) {
          let event: LiveSessionEvent;
          try {
            event = await handle.next();
          } catch (error) {
            logger.debug({ err: error, sessionId }, 'live provider read failed');
            return;
          }
          noteEvent(event);
          if (event.kind === 'closed') return;
          // The wrap-up still collects, but the creator has stopped listening.
          if (ended) continue;
          relay(event);
        }
      }

      const pumping = pump();

      send(sessionId, {
        type: 'ready',
        sessionId,
        maxSeconds: LIVE_LIMITS.maxSessionSeconds,
      });

      // The model has to be told to listen before the creator starts, or it
      // greets them and burns the first ten seconds of a five-minute session.
      handle.sendText(instruction.openingPrompt);

      /** Asks the model for the wrap-up and waits, bounded. */
      async function collectSummary(): Promise<LiveSessionSummary> {
        handle.sendText(WRAP_UP_PROMPT);

        const from = seen.length;
        const deadline = Date.now() + WRAP_UP_TIMEOUT_MS;
        let quietUntil = Date.now() + WRAP_UP_QUIET_MS;
        let lastCount = from;

        while (Date.now() < deadline) {
          if (seen.some((event) => event.kind === 'closed')) break;

          // Every new answer buys the model another quiet window, so a model
          // that keeps talking is heard out rather than cut off mid-sentence.
          if (seen.length > lastCount) {
            lastCount = seen.length;
            quietUntil = Date.now() + WRAP_UP_QUIET_MS;
          }
          if (Date.now() >= quietUntil) break;

          const waitMs = Math.min(deadline, quietUntil) - Date.now();
          if (waitMs <= 0) break;
          await waitForEvent(waitMs);
        }

        // Read *after* the wait: everything the model said during the wrap-up
        // turn, not a snapshot taken before it was asked.
        const collected = seen.flatMap((event) => (event.kind === 'text' ? [event.text] : []));
        return buildSummary(collected, elapsedSeconds(), lineIndex + 1);
      }

      const session: RunningSession = {
        sessionId,
        uid,
        projectId: validated.projectId,
        script: validated.script,
        startedAtMs,

        remainingSeconds() {
          return Math.max(0, Math.ceil((maxMs - (Date.now() - startedAtMs)) / 1000));
        },

        sendAudio(pcm: Buffer) {
          if (ended) return;
          handle.sendAudio(pcm);
        },

        endAudioStream() {
          if (ended) return;
          handle.endAudioStream();
        },

        setLine(index: number) {
          lineIndex = index;
        },

        async end() {
          if (ended) return;
          ended = true;

          const summary = await collectSummary();
          await handle.close();
          await pumping.catch(() => undefined);

          try {
            await saveSummary(uid, summary, validated.projectId);
          } catch (error) {
            // A failed history write must not cost the creator their summary on
            // screen: it is still sent to the browser either way.
            logger.error({ err: error, uid, sessionId }, 'could not save coaching summary');
          }

          send(sessionId, { type: 'ended', summary });
          close(sessionId, 1000, 'session ended');

          logger.info(
            {
              uid,
              sessionId,
              durationSeconds: summary.durationSeconds,
              linesRead: summary.linesRead,
            },
            'coaching session wrapped up',
          );
        },

        get ended() {
          return ended;
        },
      };

      // The per-session maximum, enforced here rather than trusted to the client:
      // a browser that stops sending its timer must not extend the session.
      setTimeout(() => {
        if (ended) return;
        logger.info({ uid, sessionId }, 'coaching session hit the time limit');
        send(sessionId, {
          type: 'warning',
          message: `That is the ${LIVE_LIMITS.maxSessionSeconds}-second maximum for one take.`,
        });
        void session.end();
      }, maxMs);

      return session;
    },

    async feedback(uid, request) {
      const validated = liveFeedbackRequestSchema.parse(request);
      const dna = await requireDna(uid);

      if (provider.available === false) {
        throw new ServiceUnavailableError(
          'live_unavailable',
          'The live coach is unavailable, so there is nothing to fall back to.',
        );
      }

      const instruction = buildCoachInstruction({ uid, dna, script: validated.script });

      const handle = await provider.open({
        model,
        systemInstruction: instruction.system,
        openingPrompt: instruction.openingPrompt,
        script: validated.script,
      });

      try {
        // The whole take at once: the model has no reason to interrupt a
        // recording that is already finished.
        handle.sendAudio(Buffer.from(validated.audio, 'base64'));
        handle.endAudioStream();
        handle.sendText(WRAP_UP_PROMPT);

        // Same bounded wait as a live session's wrap-up: stop as soon as the
        // model has answered and gone quiet, rather than always sitting out the
        // full timeout. A creator who records a take should not wait fifteen
        // seconds for a review that finished in one.
        const deadline = Date.now() + WRAP_UP_TIMEOUT_MS;
        let quietUntil = Date.now() + WRAP_UP_QUIET_MS;
        const collected: string[] = [];

        while (Date.now() < deadline) {
          const timeout = new Promise<'timeout'>((resolve) => {
            setTimeout(() => resolve('timeout'), Math.max(1, Math.min(deadline, quietUntil) - Date.now()));
          });
          const event = await Promise.race([handle.next(), timeout]);

          if (event === 'timeout') {
            if (Date.now() >= quietUntil) break;
            continue;
          }
          if (event.kind === 'closed') break;
          if (event.kind === 'text') {
            collected.push(event.text);
            quietUntil = Date.now() + WRAP_UP_QUIET_MS;
          }
        }

        const summary = buildSummary(collected, validated.durationSeconds, validated.script.length);
        await saveSummary(uid, summary, validated.projectId);

        return liveFeedbackResponseSchema.parse({ summary, tips: [], fallback: true });
      } finally {
        await handle.close();
      }
    },

    quota(uid) {
      // The count comes from the registry, not from the browser: a client that
      // reloads mid-session must not get a fresh allowance.
      return toQuotaResponse(registry.usedToday(uid));
    },
  };
}

/**
 * Turns whatever the model said into a summary.
 *
 * Deliberately forgiving: a live model that never produced parseable JSON still
 * yields a usable summary, because the creator watched the tips go by. The
 * fallback is "here is what we heard", not "no summary available".
 */
export function buildSummary(
  texts: readonly string[],
  durationSeconds: number,
  linesRead: number,
): LiveSessionSummary {
  const parsed = texts
    .map((text) => safeJsonObject(text))
    .filter((value): value is Record<string, unknown> => value !== null);

  const strengths = stringList(parsed, 'strengths');
  const issues = stringList(parsed, 'issues');
  const tips = stringList(parsed, 'tips');

  // A session with no model wrap-up still deserves a summary.
  if (strengths.length === 0 && issues.length === 0 && tips.length === 0) {
    return liveSessionSummarySchema.parse({
      strengths: [],
      issues: [],
      tips: ['Re-run the take with the live coach connected for a written wrap-up.'],
      durationSeconds: Math.round(durationSeconds),
      linesRead,
    });
  }

  return liveSessionSummarySchema.parse({
    strengths,
    issues,
    tips,
    durationSeconds: Math.round(durationSeconds),
    linesRead,
  });
}

function safeJsonObject(text: string): Record<string, unknown> | null {
  const match = /\{[\s\S]*\}/.exec(text);
  if (match === null) return null;
  try {
    const parsed: unknown = JSON.parse(match[0]);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function stringList(objects: readonly Record<string, unknown>[], key: string): string[] {
  const values: string[] = [];
  for (const object of objects) {
    const raw = object[key];
    if (!Array.isArray(raw)) continue;
    for (const entry of raw) {
      if (typeof entry === 'string' && entry.trim().length > 0) {
        values.push(entry.trim().slice(0, 280));
      }
    }
  }
  return values.slice(0, 6);
}

/** The DNA context block, for the route's diagnostics. */
export function dnaContextFor(dna: CreatorDna, uid: string): string {
  return buildDnaContext({ uid, dna, history: [] }).text;
}
