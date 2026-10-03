import { describe, expect, it } from 'vitest';
import {
  creatorDnaSchema,
  type CreatorDna,
  type DnaSuggestion,
  type DnaVersionSnapshot,
} from '@creatordna/shared';
import { createLogger } from '@creatordna/shared/logger';
import { createDnaLearningService } from '../services/dnaLearning.service.js';
import type { DnaLearningRepository } from '../lib/dnaLearningRepository.js';
import type { DnaRepository } from '../lib/dnaRepository.js';
import { createTextModelService } from '../services/ai/index.js';
import type { TextModelClient, TextModelResponse } from '../services/ai/index.js';

const logger = createLogger({ level: 'silent' });

/** In-memory learning store, so no test touches the filesystem. */
function memoryLearning(): DnaLearningRepository & {
  signals: { uid: string; id: string; createdAt: string }[];
  suggestions: DnaSuggestion[];
  versions: DnaVersionSnapshot[];
  runs: string[];
} {
  const state = {
    signals: [] as { uid: string; id: string; createdAt: string }[],
    suggestions: [] as DnaSuggestion[],
    versions: [] as DnaVersionSnapshot[],
    runs: [] as string[],
    lastRunAt: null as string | null,
  };

  // A fake clock that only moves forward, one second per recorded signal. The
  // watermark a run writes is "now" on this clock, which is always past every
  // signal that run consumed - the property the service's comparison relies on.
  let clock = Date.now();

  const repo: DnaLearningRepository = {
    kind: 'local-file',

    async appendSignal(uid, input) {
      const id = `sig_${state.signals.length + 1}`;
      const createdAt = new Date(clock).toISOString();
      clock += 1000;
      // Recorded at append time, exactly like the real store: a timestamp
      // derived later from the current clock would collide with the watermark.
      state.signals.push({ uid, id, createdAt });
      return { id, kind: input.kind, createdAt, label: input.label, source: input.source };
    },

    async listSignals(uid, limit) {
      const mine = state.signals.filter((signal) => signal.uid === uid).slice(0, limit);
      // Newest first, matching the Firestore ordering.
      return mine
        .map((signal, index) => ({
          id: signal.id,
          kind: 'hook_chosen' as const,
          createdAt: signal.createdAt,
          label: `signal ${index + 1}`,
          source: 'hook-lab',
        }))
        .reverse();
    },

    async putSuggestion(_uid, suggestion) {
      const withoutOld = state.suggestions.filter((item) => item.id !== suggestion.id);
      state.suggestions = [suggestion, ...withoutOld];
      return suggestion;
    },

    async listSuggestions(_uid, options) {
      return state.suggestions
        .filter((item) => options?.status === undefined || item.status === options.status)
        .slice(0, options?.limit ?? 50);
    },

    async updateSuggestion(_uid, id, patch) {
      const current = state.suggestions.find((item) => item.id === id);
      if (current === undefined) return null;
      const next = { ...current, ...patch };
      state.suggestions = state.suggestions.map((item) => (item.id === id ? next : item));
      return next;
    },

    async saveVersion(_uid, snapshot) {
      state.versions = [
        snapshot,
        ...state.versions.filter((item) => item.version !== snapshot.version),
      ].sort((a, b) => b.version - a.version);
      return snapshot;
    },

    async listVersions(_uid, limit) {
      return state.versions.slice(0, limit);
    },

    async getLastRunAt() {
      return state.lastRunAt;
    },

    async setLastRunAt(_uid, _at) {
      // One millisecond before "now": strictly after every signal this run
      // consumed (they sit on whole seconds at or below clock - 1000) and
      // strictly before the next one appended (which will be at clock). Without
      // that gap the next signal would tie with the watermark and read as seen.
      state.lastRunAt = new Date(clock - 1).toISOString();
      state.runs.push(state.lastRunAt);
    },

    async listCandidateUids(limit) {
      return [...new Set(state.signals.map((signal) => signal.uid))].slice(0, limit);
    },
  };

  return Object.assign(repo, state);
}

/** In-memory DNA profile store. */
function memoryDna(): DnaRepository {
  const stored = new Map<string, CreatorDna>();

  return {
    kind: 'local-file',

    async get(uid) {
      return stored.get(uid) ?? null;
    },

    async save(uid, dna) {
      stored.set(uid, dna);
      return dna;
    },

    async appendHistory() {
      return { id: 'h1', kind: 'feedback', createdAt: new Date().toISOString(), summary: 'x' };
    },

    async listHistory() {
      return [];
    },
  };
}

const baseDna = creatorDnaSchema.parse({
  niche: 'DSA interview prep',
  tone: ['direct', 'practical'],
  audience: ['Career switchers'],
  style: 'Short sentences, whiteboard, fast cuts',
  personality: ['blunt', 'encouraging'],
  format: 'whiteboard',
  vocabulary: ['amortized'],
  catchphrases: ['Binary search in 30 seconds'],
  dos: ['dry run the code'],
  donts: ['jargon dumps'],
  samplePosts: [],
});

interface Harness {
  service: ReturnType<typeof createDnaLearningService>;
  learning: ReturnType<typeof memoryLearning>;
  dna: DnaRepository;
  /** How many times the model was actually called. */
  calls: () => number;
  /** What the model was asked, for prompt assertions. */
  prompts: () => string[];
}

function harness(options: { response: unknown; existingDna?: CreatorDna | null }): Harness {
  const learning = memoryLearning();
  const dna = memoryDna();
  if (options.existingDna !== null && options.existingDna !== undefined) {
    void dna.save('creator-a', options.existingDna);
  }

  let calls = 0;
  const prompts: string[] = [];

  const client: TextModelClient = {
    name: 'stub',
    generate: async () => {
      calls += 1;
      prompts.push('called');
      const response: TextModelResponse = {
        text: JSON.stringify(options.response),
        promptTokens: 10,
        completionTokens: 20,
        model: 'stub-model',
      };
      return response;
    },
  };

  const ai = createTextModelService({ client, logger, primaryModel: 'stub-model' });

  const service = createDnaLearningService({
    learning,
    dna,
    ai,
    logger,
    signalLimit: 30,
    maxSuggestions: 6,
  });

  return { service, learning, dna, calls: () => calls, prompts: () => prompts };
}

const suggestionSet = {
  suggestions: [
    {
      field: 'vocabulary',
      action: 'add',
      value: ['off-by-one'],
      rationale: 'You keep picking hooks about boundary bugs.',
      evidence: ['sig_1'],
    },
  ],
};

describe('dna learning - signals', () => {
  it('records a signal and hands back the stored shape', async () => {
    const { service } = harness({ response: suggestionSet });

    const signal = await service.recordSignal('creator-a', {
      kind: 'hook_chosen',
      label: 'Three signs your study routine is broken',
      source: 'hook-lab',
    });

    expect(signal.id.length).toBeGreaterThan(0);
    expect(signal.kind).toBe('hook_chosen');
    expect(signal.label).toBe('Three signs your study routine is broken');
    expect(signal.source).toBe('hook-lab');
  });
});

describe('dna learning - the cost guard', () => {
  it('makes no model call when the creator has no signals at all', async () => {
    const h = harness({ response: suggestionSet, existingDna: baseDna });

    const result = await h.service.generateSuggestions('creator-a');

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('no-new-signals');
    expect(h.calls()).toBe(0);
  });

  it('makes no model call when every signal has already been reasoned over', async () => {
    const h = harness({ response: suggestionSet, existingDna: baseDna });
    await h.service.recordSignal('creator-a', {
      kind: 'hook_chosen',
      label: 'A hook',
      source: 'hook-lab',
    });

    const first = await h.service.generateSuggestions('creator-a');
    expect(first.skipped).toBe(false);
    expect(h.calls()).toBe(1);

    // Same signals, no new ones: the watermark must stop a second paid call.
    const second = await h.service.generateSuggestions('creator-a');
    expect(second.skipped).toBe(true);
    expect(second.reason).toBe('no-new-signals');
    expect(h.calls()).toBe(1);
  });

  it('skips entirely when the creator has no profile yet', async () => {
    const h = harness({ response: suggestionSet, existingDna: null });
    await h.service.recordSignal('creator-a', {
      kind: 'hook_chosen',
      label: 'A hook',
      source: 'hook-lab',
    });

    const result = await h.service.generateSuggestions('creator-a');

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('no-profile');
    expect(h.calls()).toBe(0);
  });
});

describe('dna learning - proposals are never applied', () => {
  it('stores proposals as pending and leaves the DNA untouched', async () => {
    const h = harness({ response: suggestionSet, existingDna: baseDna });
    await h.service.recordSignal('creator-a', {
      kind: 'hook_chosen',
      label: 'A hook',
      source: 'hook-lab',
    });

    const result = await h.service.generateSuggestions('creator-a');

    expect(result.skipped).toBe(false);
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]?.status).toBe('pending');
    expect(result.suggestions[0]?.value).toEqual(['off-by-one']);

    // The whole point: a proposal is inert until a human accepts it.
    const after = await h.dna.get('creator-a');
    expect(after?.vocabulary).toEqual(['amortized']);
    expect(after?.dnaVersion).toBe(1);
  });

  it('drops evidence ids the model could not have seen', async () => {
    const h = harness({
      response: {
        suggestions: [
          {
            field: 'vocabulary',
            action: 'add',
            value: ['hallucinated'],
            rationale: 'Invented a citation.',
            evidence: ['sig_1', 'sig_does_not_exist'],
          },
        ],
      },
      existingDna: baseDna,
    });
    await h.service.recordSignal('creator-a', {
      kind: 'hook_chosen',
      label: 'A hook',
      source: 'hook-lab',
    });

    const result = await h.service.generateSuggestions('creator-a');

    expect(result.suggestions[0]?.evidence).toEqual(['sig_1']);
  });

  it('does not store a second copy of an identical pending proposal', async () => {
    const h = harness({ response: suggestionSet, existingDna: baseDna });

    await h.service.recordSignal('creator-a', {
      kind: 'hook_chosen',
      label: 'Hook one',
      source: 'hook-lab',
    });
    await h.service.generateSuggestions('creator-a');

    await h.service.recordSignal('creator-a', {
      kind: 'hook_chosen',
      label: 'Hook two',
      source: 'hook-lab',
    });
    const second = await h.service.generateSuggestions('creator-a');

    expect(second.suggestions).toHaveLength(0);
    expect(h.calls()).toBe(2);
  });

  it('caps proposals at the configured maximum even if the model returns more', async () => {
    const h = harness({
      response: {
        suggestions: Array.from({ length: 8 }, (_unused, index) => ({
          field: 'vocabulary',
          action: 'add',
          value: [`word-${index}`],
          rationale: 'Because.',
          evidence: ['sig_1'],
        })),
      },
      existingDna: baseDna,
    });
    await h.service.recordSignal('creator-a', {
      kind: 'hook_chosen',
      label: 'A hook',
      source: 'hook-lab',
    });

    const result = await h.service.generateSuggestions('creator-a');

    expect(result.suggestions).toHaveLength(6);
  });
});

describe('dna learning - accept and reject', () => {
  async function withPending(options?: {
    value?: string[];
    field?: string;
    action?: 'add' | 'replace';
  }) {
    const h = harness({
      response: {
        suggestions: [
          {
            field: options?.field ?? 'vocabulary',
            action: options?.action ?? 'add',
            value: options?.value ?? ['off-by-one'],
            rationale: 'You keep picking hooks about boundary bugs.',
            evidence: ['sig_1'],
          },
        ],
      },
      existingDna: baseDna,
    });
    await h.service.recordSignal('creator-a', {
      kind: 'hook_chosen',
      label: 'A hook',
      source: 'hook-lab',
    });
    const run = await h.service.generateSuggestions('creator-a');
    const suggestion = run.suggestions[0];
    if (suggestion === undefined) throw new Error('no suggestion stored');
    return { h, suggestion };
  }

  it('accepting applies the value, bumps the version and snapshots both ends', async () => {
    const { h, suggestion } = await withPending();

    const profile = await h.service.acceptSuggestion('creator-a', suggestion.id);

    expect(profile.dna.vocabulary).toEqual(['amortized', 'off-by-one']);
    expect(profile.dna.dnaVersion).toBe(2);
    // Score is recalculated, not carried over.
    expect(profile.score.dnaVersion).toBe(2);
    expect(profile.score.score).toBeGreaterThan(0);

    const versions = await h.learning.listVersions('creator-a', 10);
    expect(versions.map((snapshot) => snapshot.version)).toEqual([2, 1]);
    // Version 1 is the state that produced version 2, not the new one.
    expect(versions[1]?.dna.vocabulary).toEqual(['amortized']);
    expect(versions[0]?.dna.vocabulary).toEqual(['amortized', 'off-by-one']);
    expect(versions[0]?.summary).toContain('vocabulary');
  });

  it('accepting marks the suggestion accepted so it cannot be applied twice', async () => {
    const { h, suggestion } = await withPending();

    await h.service.acceptSuggestion('creator-a', suggestion.id);

    await expect(h.service.acceptSuggestion('creator-a', suggestion.id)).rejects.toThrow(
      /already accepted/,
    );
    const after = await h.dna.get('creator-a');
    expect(after?.vocabulary).toEqual(['amortized', 'off-by-one']);
  });

  it('replacing a field overwrites rather than appends', async () => {
    const { h, suggestion } = await withPending({
      field: 'tone',
      action: 'replace',
      value: ['warm', 'playful'],
    });

    const profile = await h.service.acceptSuggestion('creator-a', suggestion.id);

    expect(profile.dna.tone).toEqual(['warm', 'playful']);
  });

  it('rejecting leaves the DNA exactly as it was', async () => {
    const { h, suggestion } = await withPending();

    const rejected = await h.service.rejectSuggestion('creator-a', suggestion.id);

    expect(rejected.status).toBe('rejected');
    expect(rejected.resolvedAt).not.toBeNull();
    const after = await h.dna.get('creator-a');
    expect(after?.vocabulary).toEqual(['amortized']);
    expect(after?.dnaVersion).toBe(1);
  });

  it('an unknown suggestion id is a 404, not a crash', async () => {
    const h = harness({ response: suggestionSet, existingDna: baseDna });

    await expect(h.service.acceptSuggestion('creator-a', 'nope')).rejects.toThrow(/no longer exists/);
    await expect(h.service.rejectSuggestion('creator-a', 'nope')).rejects.toThrow(/no longer exists/);
  });
});

describe('dna learning - version history', () => {
  it('reports the live version as current even before anything is snapshotted', async () => {
    const h = harness({ response: suggestionSet, existingDna: baseDna });

    const history = await h.service.listVersions('creator-a', 20);

    expect(history.currentVersion).toBe(1);
    expect(history.versions).toEqual([]);
  });

  it('refuses to list versions when there is no profile', async () => {
    const h = harness({ response: suggestionSet, existingDna: null });

    await expect(h.service.listVersions('creator-a')).rejects.toThrow(/finish onboarding/);
  });
});
