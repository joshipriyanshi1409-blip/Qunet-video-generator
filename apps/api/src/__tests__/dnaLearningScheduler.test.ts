import { describe, expect, it } from 'vitest';
import { createLogger } from '@creatordna/shared/logger';
import { createDnaLearningScheduler } from '../lib/dnaLearningScheduler.js';
import type { DnaLearningRepository } from '../lib/dnaLearningRepository.js';
import type { DnaLearningService, GenerateResult } from '../services/dnaLearning.service.js';

const logger = createLogger({ level: 'silent' });

/** A repository whose only interesting behaviour is who it hands back. */
function repository(uids: string[]): DnaLearningRepository {
  return {
    kind: 'local-file',
    async appendSignal() {
      throw new Error('not used');
    },
    async listSignals() {
      return [];
    },
    async putSuggestion() {
      throw new Error('not used');
    },
    async listSuggestions() {
      return [];
    },
    async updateSuggestion() {
      return null;
    },
    async saveVersion() {
      throw new Error('not used');
    },
    async listVersions() {
      return [];
    },
    async getLastRunAt() {
      return null;
    },
    async setLastRunAt() {},
    async listCandidateUids() {
      return uids;
    },
  };
}

/** A service that records what it was asked and can be told to fail per uid. */
function service(behaviour: {
  results?: Record<string, GenerateResult>;
  failFor?: readonly string[];
}): DnaLearningService & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    async recordSignal() {
      throw new Error('not used');
    },
    async listSignals() {
      return [];
    },
    async generateSuggestions(uid) {
      asked.push(uid);
      if (behaviour.failFor?.includes(uid) === true) {
        throw new Error('model unavailable');
      }
      return (
        behaviour.results?.[uid] ?? { suggestions: [], skipped: true, reason: 'no-new-signals' }
      );
    },
    async listSuggestions() {
      return [];
    },
    async acceptSuggestion() {
      throw new Error('not used');
    },
    async rejectSuggestion() {
      throw new Error('not used');
    },
    async listVersions() {
      throw new Error('not used');
    },
  };
}

function scheduler(
  uids: string[],
  behaviour: Parameters<typeof service>[0],
): ReturnType<typeof createDnaLearningScheduler> & { service: ReturnType<typeof service> } {
  const svc = service(behaviour);
  const created = createDnaLearningScheduler({
    service: svc,
    repository: repository(uids),
    logger,
    intervalMs: 1000,
    batchSize: 25,
  });
  return Object.assign(created, { service: svc });
}

describe('dna learning scheduler', () => {
  it('asks every candidate creator exactly once', async () => {
    const s = scheduler(['a', 'b', 'c'], {});

    const result = await s.runOnce();

    expect(result.considered).toBe(3);
    expect(result.skipped).toBe(3);
    expect(s.service.asked).toEqual(['a', 'b', 'c']);
  });

  it('counts generated proposals across the sweep', async () => {
    const s = scheduler(['a', 'b'], {
      results: {
        a: { suggestions: [], skipped: false },
        b: { suggestions: [], skipped: true, reason: 'no-new-signals' },
      },
    });

    const result = await s.runOnce();

    expect(result.generated).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it('keeps sweeping after one creator fails', async () => {
    // One creator's model outage must not cost everyone else their update.
    const s = scheduler(['a', 'b', 'c'], { failFor: ['b'] });

    const result = await s.runOnce();

    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.uid).toBe('b');
    expect(result.failures[0]?.error).toContain('model unavailable');
    expect(s.service.asked).toEqual(['a', 'b', 'c']);
  });

  it('drops an overlapping sweep rather than queueing a second one', async () => {
    // Two concurrent sweeps would double every model call.
    const gate = new Promise<void>((resolve) => setTimeout(resolve, 20));
    const slow = {
      ...service({}),
      async generateSuggestions() {
        await gate;
        return { suggestions: [], skipped: true, reason: 'no-new-signals' } as GenerateResult;
      },
    };
    const concurrent = createDnaLearningScheduler({
      service: slow,
      repository: repository(['a']),
      logger,
      intervalMs: 1000,
      batchSize: 25,
    });

    const first = concurrent.runOnce();
    const second = await concurrent.runOnce();

    expect(second.considered).toBe(0);
    await first;
  });

  it('starts and stops its timer', () => {
    let started = 0;
    let stopped = 0;
    const handle = { id: 'fake' } as unknown as ReturnType<typeof setInterval>;

    const s = createDnaLearningScheduler({
      service: service({}),
      repository: repository([]),
      logger,
      intervalMs: 5000,
      batchSize: 25,
      setTimer: () => {
        started += 1;
        return handle;
      },
      clearTimer: () => {
        stopped += 1;
      },
    });

    s.start();
    s.start(); // idempotent: a second start must not stack timers
    expect(started).toBe(1);

    s.stop();
    s.stop(); // idempotent too
    expect(stopped).toBe(1);
  });
});
