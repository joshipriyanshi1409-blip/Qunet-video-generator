import type { Job } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import type { PingJobData, PingJobResult } from '@creatordna/shared';
import { createLogger } from '@creatordna/shared/logger';
import { createPingProcessor } from '../jobs/ping.job.js';

function makeJob(data: PingJobData, attemptsMade: number) {
  const updateProgress = vi.fn(async (_progress: number) => undefined);
  const job = {
    id: '42',
    name: 'ping',
    data,
    attemptsMade,
    updateProgress,
  };
  return { job: job as unknown as Job<PingJobData, PingJobResult, string>, updateProgress };
}

function makeDeps() {
  const sleep = vi.fn(async () => undefined);
  return {
    sleep,
    now: () => new Date('2026-10-02T10:00:00.000Z'),
    logger: createLogger({ level: 'silent' }),
  };
}

const baseData: PingJobData = {
  message: 'hello',
  delayMs: 0,
  failFirstAttempts: 0,
  uid: 'uid_1',
};

describe('ping job processor', () => {
  it('completes and reports 100% progress', async () => {
    const deps = makeDeps();
    const { job, updateProgress } = makeJob(baseData, 0);

    const result = await createPingProcessor(deps)(job);

    expect(result).toEqual({
      message: 'hello',
      finishedAt: '2026-10-02T10:00:00.000Z',
      attempts: 1,
    });
    expect(updateProgress.mock.calls.map(([value]) => value)).toEqual([10, 60, 100]);
    expect(deps.sleep).not.toHaveBeenCalled();
  });

  it('sleeps for the requested delay before finishing', async () => {
    const deps = makeDeps();
    const { job } = makeJob({ ...baseData, delayMs: 250 }, 0);

    await createPingProcessor(deps)(job);

    expect(deps.sleep).toHaveBeenCalledWith(250);
  });

  it('fails the first N attempts so only the failed attempt is retried', async () => {
    const deps = makeDeps();
    const processor = createPingProcessor(deps);

    const first = makeJob({ ...baseData, failFirstAttempts: 1 }, 0);
    await expect(processor(first.job)).rejects.toThrow(/Simulated failure \(attempt 1 of 1\)/);
    expect(first.updateProgress).not.toHaveBeenCalled();

    const retry = makeJob({ ...baseData, failFirstAttempts: 1 }, 1);
    const result = await processor(retry.job);
    expect(result.attempts).toBe(2);
    expect(retry.updateProgress.mock.calls.map(([value]) => value)).toEqual([10, 60, 100]);
  });

  it('reports the attempt number on success', async () => {
    const deps = makeDeps();
    const { job } = makeJob(baseData, 2);
    const result = await createPingProcessor(deps)(job);
    expect(result.attempts).toBe(3);
  });
});
