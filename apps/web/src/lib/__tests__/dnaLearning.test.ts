import { describe, expect, it, vi } from 'vitest';
import { dnaSignalAppendSchema } from '@creatordna/shared';
import {
  acceptSuggestion,
  fetchSignals,
  fetchSuggestions,
  fetchVersions,
  generateSuggestions,
  recordSignal,
  rejectSuggestion,
  trackSignal,
} from '../dnaLearning';

/** Records what `request` was called with, and answers with a canned envelope. */
function stubFetch(payload: unknown, status = 200) {
  const calls: { url: string; init?: RequestInit }[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ data: payload }), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );

  return calls;
}

const signal = {
  id: 'sig_1',
  kind: 'hook_chosen' as const,
  createdAt: '2026-10-01T10:00:00.000Z',
  label: 'Three signs your study routine is broken',
  source: 'hook-lab',
};

/** `POST .../accept` answers with the whole refreshed profile. */
const profileResponse = {
  dna: {
    niche: 'DSA interview prep',
    tone: ['direct'],
    audience: ['Career switchers'],
    style: 'Short sentences',
    personality: ['blunt'],
    format: 'whiteboard',
    vocabulary: ['amortized', 'off-by-one'],
    catchphrases: [],
    dos: [],
    donts: [],
    samplePosts: [],
    audienceAgeRange: '25-34',
    audienceType: 'professionals',
    dnaVersion: 2,
  },
  score: {
    completeness: 90,
    consistency: 100,
    score: 93,
    missingFields: [],
    inconsistencies: [],
    dnaVersion: 2,
  },
  context: 'DNA context block',
  contextTokens: 42,
};

const suggestion = {
  id: 'sug_1',
  field: 'vocabulary' as const,
  action: 'add' as const,
  status: 'pending' as const,
  createdAt: '2026-10-01T11:00:00.000Z',
  resolvedAt: null,
  value: ['off-by-one'],
  rationale: 'You keep picking hooks about boundary bugs.',
  evidence: ['sig_1'],
  promptId: 'dna-learn',
  promptVersion: 1,
  model: 'stub-model',
};

describe('dnaLearning client', () => {
  it('posts a signal to /dna/signals and unwraps the envelope', async () => {
    const calls = stubFetch(signal);

    const result = await recordSignal({
      kind: 'hook_chosen',
      label: 'Three signs your study routine is broken',
      source: 'hook-lab',
    });

    expect(calls[0]?.url).toContain('/api/v1/dna/signals');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(result.id).toBe('sig_1');
    expect(result.label).toBe('Three signs your study routine is broken');
  });

  it('reads signals without a filter', async () => {
    const calls = stubFetch({ signals: [signal] });

    const result = await fetchSignals();

    expect(calls[0]?.url).toContain('/api/v1/dna/signals');
    expect(calls[0]?.url).not.toContain('limit');
    expect(result.signals).toHaveLength(1);
  });

  it('passes a limit through as a query param', async () => {
    const calls = stubFetch({ signals: [] });

    await fetchSignals(10);

    expect(calls[0]?.url).toContain('limit=10');
  });

  it('asks for proposals with a POST, and reports the skip reason', async () => {
    const calls = stubFetch({
      suggestions: [suggestion],
      skipped: false,
      reason: null,
    });

    const result = await generateSuggestions();

    expect(calls[0]?.init?.method).toBe('POST');
    expect(result.suggestions).toHaveLength(1);

    stubFetch({ suggestions: [], skipped: true, reason: 'no-new-signals' });
    const skipped = await generateSuggestions();
    expect(skipped.skipped).toBe(true);
    expect(skipped.reason).toBe('no-new-signals');
  });

  it('filters suggestions by status', async () => {
    const calls = stubFetch({ suggestions: [], skipped: false });

    await fetchSuggestions('accepted');

    expect(calls[0]?.url).toContain('status=accepted');
  });

  it('encodes the suggestion id into the accept and reject paths', async () => {
    const acceptCalls = stubFetch(profileResponse);
    await acceptSuggestion('sug 1/x');
    // An unescaped id would break the path, not just look ugly.
    expect(acceptCalls[0]?.url).toContain('sug%201%2Fx');
    expect(acceptCalls[0]?.url).toContain('/accept');

    const rejectCalls = stubFetch(suggestion);
    await rejectSuggestion('sug 1/x');
    expect(rejectCalls[0]?.url).toContain('sug%201%2Fx');
    expect(rejectCalls[0]?.url).toContain('/reject');
  });

  it('accept answers with the refreshed profile so the ring needs no second call', async () => {
    stubFetch(profileResponse);

    const profile = await acceptSuggestion('sug_1');

    expect(profile.dna.dnaVersion).toBe(2);
    expect(profile.dna.vocabulary).toContain('off-by-one');
    expect(profile.score.score).toBe(93);
  });

  it('reads the version history with the live version', async () => {
    stubFetch({ versions: [], currentVersion: 3 });

    const result = await fetchVersions(20);

    expect(result.currentVersion).toBe(3);
    expect(result.versions).toEqual([]);
  });
});

describe('trackSignal', () => {
  it('resolves even when the request fails', async () => {
    // Losing a signal must never interrupt the creator's actual task.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 500 })),
    );

    await expect(trackSignal({ kind: 'hook_chosen', label: 'A hook', source: 'hook-lab' })).resolves.toBeUndefined();
  });

  it('validates its input before sending, so a bad label never reaches the API', async () => {
    const calls = stubFetch(signal);

    await trackSignal({ kind: 'hook_chosen', label: '   ', source: 'hook-lab' });

    // An empty label is rejected locally, so nothing is sent at all.
    expect(calls).toHaveLength(0);
  });

  it('sends a well-formed signal', async () => {
    const calls = stubFetch(signal);

    await trackSignal({ kind: 'hook_chosen', label: 'A hook', source: 'hook-lab' });

    expect(calls).toHaveLength(1);
  });

  it('shares its write schema with the API', () => {
    // One schema, both sides: if these drift, the request is rejected locally.
    expect(dnaSignalAppendSchema.safeParse({ kind: 'hook_chosen', label: 'x', source: 'y' }).success).toBe(true);
  });
});
