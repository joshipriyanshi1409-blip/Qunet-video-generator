import { describe, expect, it } from 'vitest';
import {
  COACH_TIP_KINDS,
  COACH_TIP_LABELS,
  LIVE_AUDIO_FORMAT,
  LIVE_DAILY_SESSION_CAP,
  LIVE_MAX_SESSION_SECONDS,
  LIVE_WS_CLOSE,
  coachTipSchema,
  liveClientMessageSchema,
  liveFeedbackRequestSchema,
  liveFeedbackResponseSchema,
  liveQuotaResponseSchema,
  liveSessionScriptSchema,
  liveSessionStartSchema,
  liveSessionSummarySchema,
  liveServerMessageSchema,
  type CoachTip,
} from '../schemas/index.js';
import {
  LIVE_LIMITS,
  dailyCapReached,
  reconnectDelayMs,
  remainingSessionSeconds,
  remainingToday,
  sessionProgress,
  sessionTimeExpired,
  shouldReconnect,
  toQuotaResponse,
  utcDayKey,
} from '../lib/liveCoachLimits.js';

/**
 * Phase 6 contracts.
 *
 * The coaching socket is the one place where a malformed message is not merely
 * ugly - it is a session the creator cannot use. So the schemas are pinned here
 * from both directions: what the browser may send, and what it may receive.
 */

const tip = (overrides: Partial<CoachTip> = {}): CoachTip => ({
  kind: 'pace',
  severity: 'info',
  message: 'You are rushing the second beat.',
  ...overrides,
});

describe('coachTipSchema', () => {
  it('accepts every kind the coach is allowed to comment on', () => {
    for (const kind of COACH_TIP_KINDS) {
      expect(coachTipSchema.safeParse(tip({ kind })).success).toBe(true);
    }
  });

  it('rejects a kind outside the five', () => {
    expect(coachTipSchema.safeParse(tip({ kind: 'volume' as never })).success).toBe(false);
  });

  it('defaults atSeconds to undefined rather than zero', () => {
    const parsed = coachTipSchema.parse(tip());
    expect(parsed.atSeconds).toBeUndefined();
  });

  it('rejects an empty message - a tip has to say something', () => {
    expect(coachTipSchema.safeParse(tip({ message: '   ' })).success).toBe(false);
  });

  it('has a label for every kind, so the feed never renders a blank chip', () => {
    for (const kind of COACH_TIP_KINDS) {
      expect(COACH_TIP_LABELS[kind].length).toBeGreaterThan(0);
    }
  });
});

describe('the audio contract', () => {
  it('is 16 kHz mono 16-bit PCM, which is what the Live API documents', () => {
    expect(LIVE_AUDIO_FORMAT.sampleRate).toBe(16_000);
    expect(LIVE_AUDIO_FORMAT.channels).toBe(1);
    expect(LIVE_AUDIO_FORMAT.bitDepth).toBe(16);
    expect(LIVE_AUDIO_FORMAT.mimeType).toBe('audio/pcm;rate=16000');
  });
});

describe('liveSessionStartSchema', () => {
  it('requires at least one non-empty script line', () => {
    expect(liveSessionStartSchema.safeParse({ script: ['Hook'] }).success).toBe(true);
    expect(liveSessionStartSchema.safeParse({ script: [] }).success).toBe(false);
    expect(liveSessionStartSchema.safeParse({ script: ['  '] }).success).toBe(false);
  });

  it('accepts a projectId so the session can be attributed', () => {
    expect(
      liveSessionStartSchema.parse({ script: ['Hook'], projectId: 'proj_1' }).projectId,
    ).toBe('proj_1');
  });

  it('caps the script at 40 lines', () => {
    const tooMany = Array.from({ length: 41 }, (_, index) => `line ${index}`);
    expect(liveSessionStartSchema.safeParse({ script: tooMany }).success).toBe(false);
    expect(liveSessionScriptSchema.safeParse(tooMany.slice(0, 40)).success).toBe(true);
  });
});

describe('the browser -> API socket messages', () => {
  it('accepts audio, line, audio-stream-end and end', () => {
    expect(liveClientMessageSchema.parse({ type: 'audio', data: 'AAAA' })).toEqual({
      type: 'audio',
      data: 'AAAA',
    });
    expect(liveClientMessageSchema.parse({ type: 'line', index: 3 })).toEqual({
      type: 'line',
      index: 3,
    });
    expect(liveClientMessageSchema.parse({ type: 'audio-stream-end' })).toEqual({
      type: 'audio-stream-end',
    });
    expect(liveClientMessageSchema.parse({ type: 'end' })).toEqual({ type: 'end' });
  });

  it('rejects an empty audio chunk', () => {
    expect(liveClientMessageSchema.safeParse({ type: 'audio', data: '' }).success).toBe(false);
  });

  it('rejects an unknown message type instead of ignoring it', () => {
    expect(liveClientMessageSchema.safeParse({ type: 'restart' }).success).toBe(false);
  });

  it('rejects a line index past the end of the script', () => {
    expect(liveClientMessageSchema.safeParse({ type: 'line', index: 41 }).success).toBe(false);
  });
});

describe('the API -> browser socket messages', () => {
  it('accepts a tip', () => {
    const parsed = liveServerMessageSchema.parse({ type: 'tip', tip: tip() });
    expect(parsed.type).toBe('tip');
  });

  it('accepts a transcript, final or partial', () => {
    expect(liveServerMessageSchema.parse({ type: 'transcript', text: 'hi', final: false }).type).toBe(
      'transcript',
    );
    expect(liveServerMessageSchema.parse({ type: 'transcript', text: 'hi', final: true }).type).toBe(
      'transcript',
    );
  });

  it('accepts model audio so the browser can play spoken feedback', () => {
    const parsed = liveServerMessageSchema.parse({
      type: 'audio',
      data: 'AAAA',
      mimeType: 'audio/pcm;rate=24000',
    });
    expect(parsed.type).toBe('audio');
  });

  it('carries the summary inside the ended message', () => {
    const summary = liveSessionSummarySchema.parse({
      strengths: ['Steady pace'],
      issues: ['Three "um"s in the hook'],
      tips: ['Pause after the first line'],
      durationSeconds: 42,
      linesRead: 3,
    });
    const parsed = liveServerMessageSchema.parse({ type: 'ended', summary });
    expect(parsed.type).toBe('ended');
    if (parsed.type === 'ended') {
      expect(parsed.summary.issues).toHaveLength(1);
    }
  });

  it('carries an error with a code the browser can branch on', () => {
    const parsed = liveServerMessageSchema.parse({
      type: 'error',
      error: { code: 'live_unavailable', message: 'No live model.' },
    });
    expect(parsed.type).toBe('error');
  });

  it('tells the browser the session budget on ready', () => {
    const parsed = liveServerMessageSchema.parse({
      type: 'ready',
      sessionId: 's1',
      maxSeconds: LIVE_MAX_SESSION_SECONDS,
    });
    expect(parsed.type).toBe('ready');
  });
});

describe('the fallback (post-recording) path', () => {
  it('accepts a whole take plus the script', () => {
    const parsed = liveFeedbackRequestSchema.parse({
      script: ['Hook', 'CTA'],
      audio: 'AAAA',
      durationSeconds: 12,
    });
    expect(parsed.durationSeconds).toBe(12);
  });

  it('rejects a take with no audio at all', () => {
    expect(liveFeedbackRequestSchema.safeParse({ script: ['Hook'], audio: '' }).success).toBe(false);
  });

  it('returns a summary, tips and a flag saying it was the fallback', () => {
    const parsed = liveFeedbackResponseSchema.parse({
      summary: {
        strengths: [],
        issues: [],
        tips: ['Slow down'],
        durationSeconds: 12,
        linesRead: 1,
      },
      tips: [tip()],
      fallback: true,
    });
    expect(parsed.fallback).toBe(true);
  });
});

describe('session limits', () => {
  it('caps a session at 5 minutes and a creator at 10 per day', () => {
    expect(LIVE_MAX_SESSION_SECONDS).toBe(300);
    expect(LIVE_DAILY_SESSION_CAP).toBe(10);
    expect(LIVE_LIMITS).toEqual({ maxSessionSeconds: 300, dailyCap: 10 });
  });

  it('reports the daily quota', () => {
    expect(toQuotaResponse(0)).toEqual({
      usedToday: 0,
      dailyCap: 10,
      remainingToday: 10,
      maxSessionSeconds: 300,
    });
    expect(toQuotaResponse(10).remainingToday).toBe(0);
    expect(liveQuotaResponseSchema.safeParse(toQuotaResponse(3)).success).toBe(true);
  });

  it('stops a creator at the daily cap', () => {
    expect(dailyCapReached(9, 10)).toBe(false);
    expect(dailyCapReached(10, 10)).toBe(true);
    expect(dailyCapReached(11, 10)).toBe(true);
    expect(remainingToday(11, 10)).toBe(0);
  });

  it('counts down the session in whole seconds', () => {
    const start = 1_000_000;
    expect(remainingSessionSeconds(start, start, 300)).toBe(300);
    expect(remainingSessionSeconds(start, start + 30_000, 300)).toBe(270);
    expect(remainingSessionSeconds(start, start + 299_000, 300)).toBe(1);
    expect(remainingSessionSeconds(start, start + 300_000, 300)).toBe(0);
  });

  it('never goes negative, even if the clock jumps', () => {
    expect(remainingSessionSeconds(1_000_000, 1_000_000 + 10_000_000, 300)).toBe(0);
  });

  it('expires exactly at the maximum', () => {
    const start = 0;
    expect(sessionTimeExpired(start, 299_000, 300)).toBe(false);
    expect(sessionTimeExpired(start, 300_000, 300)).toBe(true);
    expect(sessionTimeExpired(start, 400_000, 300)).toBe(true);
  });

  it('reports progress as a 0-1 fraction', () => {
    expect(sessionProgress(0, 0, 300)).toBe(0);
    expect(sessionProgress(0, 150_000, 300)).toBeCloseTo(0.5);
    expect(sessionProgress(0, 999_000, 300)).toBe(1);
  });
});

describe('utcDayKey', () => {
  it('keys the cap on the UTC day, not the local one', () => {
    // 23:30 UTC on the 1st is already the 2nd in Calcutta (+5:30).
    expect(utcDayKey(new Date('2026-10-01T23:30:00.000Z'))).toBe('2026-10-01');
    expect(utcDayKey(new Date('2026-10-02T00:30:00.000Z'))).toBe('2026-10-02');
  });
});

describe('reconnect policy', () => {
  it('backs off exponentially and jitters', () => {
    const first = reconnectDelayMs(1, 500, 15_000);
    const fifth = reconnectDelayMs(5, 500, 15_000);
    expect(first).toBeGreaterThanOrEqual(250);
    expect(first).toBeLessThanOrEqual(500);
    // Attempt 5 would be 8s uncapped; jitter keeps it in the 4s-8s band.
    expect(fifth).toBeGreaterThanOrEqual(4000);
    expect(fifth).toBeLessThanOrEqual(8000);
  });

  it('caps the delay', () => {
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      expect(reconnectDelayMs(attempt, 500, 15_000)).toBeLessThanOrEqual(15_000);
    }
  });

  it('reconnects on transient closes only', () => {
    expect(shouldReconnect(1006)).toBe(true);
    expect(shouldReconnect(1011)).toBe(true);
    // A policy close is the API saying "do not come back".
    expect(shouldReconnect(LIVE_WS_CLOSE.timeLimit)).toBe(false);
    expect(shouldReconnect(LIVE_WS_CLOSE.quota)).toBe(false);
    expect(shouldReconnect(LIVE_WS_CLOSE.liveUnavailable)).toBe(false);
  });

  it('uses distinct close codes for the three policy outcomes', () => {
    const codes = Object.values(LIVE_WS_CLOSE);
    expect(new Set(codes).size).toBe(codes.length);
  });
});
