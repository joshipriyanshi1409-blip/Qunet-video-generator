import { describe, expect, it } from 'vitest';
import {
  ETA_MIN_ELAPSED_MS,
  ETA_MIN_PROGRESS_PERCENT,
  estimateEta,
  etaHint,
  formatEta,
} from '../eta';

/**
 * The ETA is measured, not predicted, so the tests are about *when it refuses to
 * answer* as much as about the arithmetic. A confident wrong number is the failure
 * mode this module exists to avoid.
 */

describe('estimateEta', () => {
  it('reports zero for a finished job', () => {
    expect(estimateEta({ progress: 100, elapsedMs: 60_000 })).toEqual({ seconds: 0, reason: 'done' });
  });

  it('refuses to answer before the first stage reports in', () => {
    const estimate = estimateEta({ progress: 0, elapsedMs: 30_000 });
    expect(estimate.seconds).toBeNull();
    expect(estimate.reason).toBe('warming-up');
  });

  it('refuses to answer below the minimum progress', () => {
    const estimate = estimateEta({
      progress: ETA_MIN_PROGRESS_PERCENT - 0.5,
      elapsedMs: 60_000,
    });
    expect(estimate.reason).toBe('warming-up');
  });

  it('refuses to answer before enough time has passed for a real rate', () => {
    const estimate = estimateEta({ progress: 40, elapsedMs: ETA_MIN_ELAPSED_MS - 1 });
    expect(estimate.reason).toBe('warming-up');
  });

  it('extrapolates the observed rate', () => {
    // 10% in 10s -> 90% left -> 90 seconds.
    const estimate = estimateEta({ progress: 10, elapsedMs: 10_000 });
    expect(estimate.seconds).toBe(90);
    expect(estimate.reason).toBe('done');
  });

  it('gives a shorter estimate as the job moves faster', () => {
    const slow = estimateEta({ progress: 20, elapsedMs: 20_000 });
    const fast = estimateEta({ progress: 20, elapsedMs: 5_000 });
    expect(slow.seconds).not.toBeNull();
    expect(fast.seconds).not.toBeNull();
    expect(fast.seconds as number).toBeLessThan(slow.seconds as number);
  });

  it('distinguishes a stalled job from one that is still warming up', () => {
    const stalled = estimateEta({ progress: -5, elapsedMs: 60_000 });
    expect(stalled.reason).toBe('stalled');
    expect(stalled.seconds).toBeNull();
  });

  it('survives nonsense input rather than producing NaN', () => {
    const estimate = estimateEta({ progress: Number.NaN, elapsedMs: Number.NaN });
    expect(estimate.reason).toBe('warming-up');
    expect(estimate.seconds).toBeNull();
  });

  it('never returns a negative estimate', () => {
    expect(estimateEta({ progress: 99.9, elapsedMs: 1 }).seconds).toBeNull();
  });
});

describe('formatEta', () => {
  it('says it is estimating when there is no number', () => {
    expect(formatEta(null)).toBe('Estimating…');
  });

  it('counts seconds under a minute', () => {
    expect(formatEta(42)).toBe('about 42s left');
  });

  it('switches to minutes past a minute, rounding up', () => {
    expect(formatEta(61)).toBe('about 2 min left');
    expect(formatEta(120)).toBe('about 2 min left');
  });

  it('says any moment for a job that is done but not marked', () => {
    expect(formatEta(0)).toBe('Any moment now');
  });
});

describe('etaHint', () => {
  it('explains the warming-up case', () => {
    expect(etaHint('warming-up')).toMatch(/first stage reports in/);
  });

  it('explains a stall without blaming the creator', () => {
    expect(etaHint('stalled')).toMatch(/while a clip renders/);
  });

  it('says nothing when there is a real estimate', () => {
    expect(etaHint('done')).toBe('');
  });
});
