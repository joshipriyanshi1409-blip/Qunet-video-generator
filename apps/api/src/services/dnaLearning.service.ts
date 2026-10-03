import {
  DNA_FIELD_LIMITS,
  buildDnaContext,
  computeDnaSyncScore,
  creatorDnaSchema,
  dnaSuggestionSchema,
  dnaSuggestionSetSchema,
  type CreatorDna,
  type DnaProfileResponse,
  type DnaSignal,
  type DnaSignalAppend,
  type DnaSignalKind,
  type DnaSuggestion,
  type DnaSuggestionAction,
  type DnaSuggestionDraft,
  type DnaSuggestionField,
  type DnaSuggestionSet,
  type DnaSuggestionStatus,
  type DnaVersionsResponse,
} from '@creatordna/shared';
import { formatSignalsBlock, prompts } from '@creatordna/prompts';
import type { Logger } from 'pino';
import { BadRequestError, ConflictError, NotFoundError } from '../lib/errors.js';
import type { DnaLearningRepository } from '../lib/dnaLearningRepository.js';
import type { DnaRepository } from '../lib/dnaRepository.js';
import type { TextModelService } from './ai/index.js';
import { AiValidationError } from './ai/index.js';

/**
 * The learning loop.
 *
 * Signals in, proposals out, and a human in the middle. The one rule that shapes
 * every method here: **nothing writes to the DNA without an explicit accept.**
 * `generateSuggestions` stores drafts as `pending`; only `acceptSuggestion`
 * touches the profile, and it is the only method that does.
 */

export interface DnaLearningServiceDeps {
  learning: DnaLearningRepository;
  /** The profile store. Read for context, written only on accept. */
  dna: DnaRepository;
  ai: TextModelService;
  logger: Logger;
  /** How many recent signals one run reasons from. */
  signalLimit: number;
  /** Hard ceiling on proposals per run, independent of what the model returns. */
  maxSuggestions: number;
}

export interface GenerateResult {
  suggestions: DnaSuggestion[];
  /** True when the run was skipped - no new signals, or no profile yet. */
  skipped: boolean;
  /** Why it was skipped, for the log and the UI. */
  reason?: 'no-profile' | 'no-new-signals';
}

export interface DnaLearningService {
  recordSignal(uid: string, input: DnaSignalAppend): Promise<DnaSignal>;
  listSignals(uid: string, limit?: number): Promise<DnaSignal[]>;
  generateSuggestions(uid: string): Promise<GenerateResult>;
  listSuggestions(uid: string, status?: DnaSuggestionStatus): Promise<DnaSuggestion[]>;
  acceptSuggestion(uid: string, id: string): Promise<DnaProfileResponse>;
  rejectSuggestion(uid: string, id: string): Promise<DnaSuggestion>;
  listVersions(uid: string, limit?: number): Promise<DnaVersionsResponse>;
}

/** A new `dnaVersion` only when the content actually changed. */
function nextVersion(existing: CreatorDna | null, incoming: CreatorDna): number {
  if (existing === null) return 1;
  const { dnaVersion: _a, updatedAt: _b, ...before } = existing;
  const { dnaVersion: _c, updatedAt: _d, ...after } = incoming;
  return JSON.stringify(before) === JSON.stringify(after)
    ? existing.dnaVersion
    : existing.dnaVersion + 1;
}

/** Case-insensitive, order-preserving de-duplication. */
function dedupe(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.trim().toLowerCase();
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    out.push(value.trim());
  }
  return out;
}

/**
 * Applies one proposal to a profile.
 *
 * `style` is a single string rather than a list, so `add` and `replace` collapse
 * to the same operation there - appending to a style description is just a
 * longer style description.
 */
function applyProposal(
  dna: CreatorDna,
  field: DnaSuggestionField,
  action: DnaSuggestionAction,
  value: readonly string[],
): CreatorDna {
  const limit = DNA_FIELD_LIMITS[field];

  if (field === 'style') {
    const text = dedupe(value).join(' ').slice(0, 600);
    if (text.length === 0) {
      throw new BadRequestError('That suggestion has no usable style text.');
    }
    return creatorDnaSchema.parse({ ...dna, style: text });
  }

  const current: string[] = dna[field];
  const merged = action === 'replace' ? dedupe(value) : dedupe([...current, ...value]);
  const capped = merged.slice(0, limit);

  if (capped.length === 0) {
    throw new BadRequestError('That suggestion would empty a required field.');
  }
  return creatorDnaSchema.parse({ ...dna, [field]: capped });
}

/** Same shape the DNA service returns, so the UI reads one response type. */
async function profileResponse(
  deps: Pick<DnaLearningServiceDeps, 'dna'>,
  uid: string,
  dna: CreatorDna,
  historyLimit: number,
): Promise<DnaProfileResponse> {
  const history = await deps.dna.listHistory(uid, historyLimit);
  const context = buildDnaContext({ uid, dna, history, maxHistoryItems: historyLimit });
  return {
    dna,
    score: computeDnaSyncScore(dna),
    context: context.text,
    contextTokens: context.tokens,
  };
}

const HISTORY_LIMIT = 5;

export function createDnaLearningService(deps: DnaLearningServiceDeps): DnaLearningService {
  const { learning, dna, ai, logger, signalLimit, maxSuggestions } = deps;

  return {
    async recordSignal(uid, input) {
      const signal = await learning.appendSignal(uid, input);
      logger.info({ uid, kind: signal.kind, source: signal.source }, 'dna signal recorded');
      return signal;
    },

    async listSignals(uid, limit = 50) {
      return learning.listSignals(uid, Math.min(Math.max(1, limit), signalLimit));
    },

    /**
     * Reasons over signals the model has not seen yet and stores proposals.
     *
     * The `lastRunAt` watermark is what keeps this affordable: a periodic job that
     * fans out to every user on a timer would call the model for creators who have
     * changed nothing, which is exactly the cost guard the quota exists to stop.
     * When there is nothing new the method returns without touching the model.
     */
    async generateSuggestions(uid) {
      const profile = await dna.get(uid);
      if (profile === null) {
        return { suggestions: [], skipped: true, reason: 'no-profile' };
      }

      const lastRunAt = await learning.getLastRunAt(uid);
      const recent = await learning.listSignals(uid, signalLimit);
      const fresh =
        lastRunAt === null ? recent : recent.filter((signal) => signal.createdAt > lastRunAt);

      if (fresh.length === 0) {
        logger.debug({ uid, lastRunAt }, 'dna learn skipped - no new signals');
        return { suggestions: [], skipped: true, reason: 'no-new-signals' };
      }

      const template = prompts.get('dna-learn');
      const messages = prompts.render('dna-learn', {
        dna_niche: profile.niche,
        dna_tone: profile.tone.join(', '),
        dna_audience: profile.audience.join(', '),
        dna_style: profile.style,
        dna_personality: profile.personality.join(', '),
        dna_vocabulary: profile.vocabulary.join(', ') || 'none listed',
        dna_catchphrases: profile.catchphrases.join(', ') || 'none listed',
        dna_dos: profile.dos.join(', ') || 'none listed',
        dna_donts: profile.donts.join(', ') || 'none listed',
        signals_block: formatSignalsBlock(fresh),
      });

      logger.info(
        { uid, promptId: template.id, promptVersion: template.version, signals: fresh.length },
        'dna learn run started',
      );

      let result;
      try {
        result = await ai.callJson<DnaSuggestionSet>(messages, {
          schema: dnaSuggestionSetSchema,
          promptId: template.id,
          promptVersion: template.version,
          uid,
          operation: 'dna-learn',
          repromptHint:
            'Remember: "evidence" must hold signal ids copied from the list, and "value" entries must be short.',
        });
      } catch (error) {
        if (error instanceof AiValidationError) {
          logger.error({ uid, issues: error.issues }, 'dna learn rejected by the model');
        }
        throw error;
      }

      // Only ids the model could actually have seen. A hallucinated id would
      // otherwise render as a citation to evidence that does not exist.
      const knownIds = new Set(fresh.map((signal) => signal.id));
      const pending = await learning.listSuggestions(uid, { status: 'pending', limit: 50 });

      const stored: DnaSuggestion[] = [];
      let duplicates = 0;

      for (const draft of result.data.suggestions.slice(0, maxSuggestions)) {
        const suggestion = buildSuggestion(draft, result.usage.model, knownIds, template);

        const isDuplicate = pending.some(
          (existing) =>
            existing.field === suggestion.field &&
            existing.action === suggestion.action &&
            existing.value.join('|').toLowerCase() === suggestion.value.join('|').toLowerCase(),
        );
        if (isDuplicate) {
          duplicates += 1;
          continue;
        }

        stored.push(await learning.putSuggestion(uid, suggestion));
      }

      // Only watermark on success: a failed run must leave the signals unseen so
      // the next attempt reasons over them rather than silently dropping them.
      await learning.setLastRunAt(uid, new Date().toISOString());

      logger.info(
        {
          uid,
          stored: stored.length,
          duplicates,
          reprompted: result.reprompted,
          model: result.usage.model,
        },
        'dna learn run complete',
      );

      return { suggestions: stored, skipped: false };
    },

    async listSuggestions(uid, status) {
      return learning.listSuggestions(uid, { status, limit: 50 });
    },

    /**
     * The only method that writes to the DNA on the strength of a proposal.
     *
     * Order matters: the outgoing version is snapshotted *before* the new one is
     * written, so version N in the history is the state that actually produced
     * version N+1. A version that already has a snapshot (because it was created
     * by an earlier accept) is not re-snapshotted.
     */
    async acceptSuggestion(uid, id) {
      const suggestion = (await learning.listSuggestions(uid, { limit: 50 })).find(
        (item) => item.id === id,
      );
      if (suggestion === undefined) {
        throw new NotFoundError('That suggestion no longer exists.');
      }
      if (suggestion.status !== 'pending') {
        throw new ConflictError(`That suggestion was already ${suggestion.status}.`);
      }

      const existing = await dna.get(uid);
      if (existing === null) {
        throw new NotFoundError('No Creator DNA yet - finish onboarding first.');
      }

      const snapshots = await learning.listVersions(uid, 50);
      if (!snapshots.some((snapshot) => snapshot.version === existing.dnaVersion)) {
        await learning.saveVersion(uid, {
          version: existing.dnaVersion,
          savedAt: new Date().toISOString(),
          summary: 'Profile as it stood before the next accepted update.',
          dna: existing,
        });
      }

      const applied = applyProposal(
        existing,
        suggestion.field,
        suggestion.action,
        suggestion.value,
      );
      const versioned = creatorDnaSchema.parse({
        ...applied,
        dnaVersion: nextVersion(existing, applied),
      });

      await learning.saveVersion(uid, {
        version: versioned.dnaVersion,
        savedAt: new Date().toISOString(),
        summary: describeAcceptance(suggestion),
        dna: versioned,
      });

      await dna.save(uid, versioned);
      await dna.appendHistory(
        uid,
        'feedback',
        `Accepted DNA update: ${describeAcceptance(suggestion)}`,
      );

      await learning.updateSuggestion(uid, id, {
        status: 'accepted',
        resolvedAt: new Date().toISOString(),
      });

      logger.info(
        { uid, suggestionId: id, field: suggestion.field, dnaVersion: versioned.dnaVersion },
        'dna suggestion accepted',
      );

      return profileResponse(deps, uid, versioned, HISTORY_LIMIT);
    },

    async rejectSuggestion(uid, id) {
      const updated = await learning.updateSuggestion(uid, id, {
        status: 'rejected',
        resolvedAt: new Date().toISOString(),
      });
      if (updated === null) {
        throw new NotFoundError('That suggestion no longer exists.');
      }
      logger.info({ uid, suggestionId: id, field: updated.field }, 'dna suggestion rejected');
      return updated;
    },

    async listVersions(uid, limit = 20) {
      const profile = await dna.get(uid);
      if (profile === null) {
        throw new NotFoundError('No Creator DNA yet - finish onboarding first.');
      }
      const versions = await learning.listVersions(uid, Math.min(Math.max(1, limit), 50));
      return { versions, currentVersion: profile.dnaVersion };
    },
  };
}

/** Turns a model draft into a stored proposal. Ids and status are ours, not the model's. */
function buildSuggestion(
  draft: DnaSuggestionDraft,
  model: string,
  knownIds: ReadonlySet<string>,
  template: { id: string; version: number },
): DnaSuggestion {
  return dnaSuggestionSchema.parse({
    id: `sug_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    field: draft.field,
    action: draft.action,
    status: 'pending',
    createdAt: new Date().toISOString(),
    value: draft.value,
    rationale: draft.rationale,
    evidence: draft.evidence.filter((id) => knownIds.has(id)),
    promptId: template.id,
    promptVersion: template.version,
    model,
  });
}

/** One line for the version history and the DNA activity feed. */
function describeAcceptance(suggestion: DnaSuggestion): string {
  const verb = suggestion.action === 'add' ? 'Added to' : 'Replaced';
  return `${verb} ${suggestion.field}: ${suggestion.value.join(', ')}`;
}

/** Re-exported so the worker can type its job payload without a second import. */
export type { DnaSignalKind };
