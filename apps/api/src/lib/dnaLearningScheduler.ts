import type { Logger } from 'pino';
import type { DnaLearningRepository } from './dnaLearningRepository.js';
import type { DnaLearningService } from '../services/dnaLearning.service.js';

/**
 * The periodic half of the learning loop.
 *
 * A timer that asks the service to reason over each creator's unseen signals.
 * The service decides whether a model call is actually needed - this scheduler
 * only decides *who* to ask and *when*.
 *
 * **Why this is a timer in the API process rather than a BullMQ repeatable job.**
 * The proposal step is a model call, and the AI wrapper that owns retries,
 * timeouts, token logging and the fallback model lives in this process. Moving
 * the job to the worker would mean a second wrapper, which is the one thing the
 * architecture forbids. The render pipeline is the heavy work that must live in
 * the worker; a few model calls an hour are not that.
 *
 * The trade-off is stated plainly: a timer does not survive a restart and does
 * not coordinate between replicas. `TODO(phase-10)` moves this to a repeatable
 * BullMQ job once the wrapper is extracted into a shared package.
 */
export interface DnaLearningSchedulerDeps {
  service: DnaLearningService;
  repository: DnaLearningRepository;
  logger: Logger;
  /** Milliseconds between sweeps. */
  intervalMs: number;
  /** How many creators one sweep touches. The next sweep picks up the rest. */
  batchSize: number;
  /** Injectable so tests never wait on a real timer. */
  setTimer?: (handler: () => void, ms: number) => ReturnType<typeof setInterval>;
  clearTimer?: (handle: ReturnType<typeof setInterval>) => void;
}

export interface SweepResult {
  /** Creators considered. */
  considered: number;
  /** Creators a proposal was actually generated for. */
  generated: number;
  /** Creators skipped because there was nothing new to reason over. */
  skipped: number;
  /** Proposals stored across the whole sweep. */
  suggestions: number;
  /** Per-creator failures. One creator's error must not abort the sweep. */
  failures: { uid: string; error: string }[];
}

export interface DnaLearningScheduler {
  start(): void;
  stop(): void;
  /** One pass. Exposed so the smoke script and tests can drive it directly. */
  runOnce(): Promise<SweepResult>;
}

export function createDnaLearningScheduler(
  deps: DnaLearningSchedulerDeps,
): DnaLearningScheduler {
  const { service, repository, logger, intervalMs, batchSize } = deps;
  const setTimer = deps.setTimer ?? ((handler, ms) => setInterval(handler, ms));
  const clearTimer = deps.clearTimer ?? ((handle) => clearInterval(handle));

  let handle: ReturnType<typeof setInterval> | null = null;
  let running = false;

  async function runOnce(): Promise<SweepResult> {
    // A sweep that overlaps itself would double every model call, so a second
    // invocation while one is in flight is dropped rather than queued.
    if (running) {
      logger.debug('dna learn sweep already running - skipping this tick');
      return { considered: 0, generated: 0, skipped: 0, suggestions: 0, failures: [] };
    }
    running = true;

    const result: SweepResult = {
      considered: 0,
      generated: 0,
      skipped: 0,
      suggestions: 0,
      failures: [],
    };

    try {
      const uids = await repository.listCandidateUids(batchSize);
      result.considered = uids.length;

      for (const uid of uids) {
        try {
          const run = await service.generateSuggestions(uid);
          if (run.skipped === true) {
            result.skipped += 1;
          } else {
            result.generated += 1;
            result.suggestions += run.suggestions.length;
          }
        } catch (error) {
          // One creator's failure is logged and the sweep continues: a bad
          // profile or a model outage must not stop everyone else's updates.
          result.failures.push({
            uid,
            error: error instanceof Error ? error.message : String(error),
          });
          logger.warn({ uid, err: error }, 'dna learn failed for one creator');
        }
      }

      if (result.generated > 0 || result.failures.length > 0) {
        logger.info(result, 'dna learn sweep complete');
      } else {
        logger.debug(result, 'dna learn sweep found nothing to do');
      }

      return result;
    } finally {
      running = false;
    }
  }

  return {
    start() {
      if (handle !== null) return;
      handle = setTimer(() => void runOnce(), intervalMs);
      logger.info({ intervalMs, batchSize }, 'dna learn scheduler started');
    },

    stop() {
      if (handle === null) return;
      clearTimer(handle);
      handle = null;
      logger.info('dna learn scheduler stopped');
    },

    runOnce,
  };
}
